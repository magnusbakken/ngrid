import ResizeObserver from 'resize-observer-polyfill';
import { asapScheduler, animationFrameScheduler, fromEventPattern } from 'rxjs';
import { filter, take, tap, observeOn, switchMap, map, mapTo, startWith, pairwise, debounceTime, skip } from 'rxjs/operators';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  Injector,
  ChangeDetectionStrategy,
  ViewChild,
  ViewChildren,
  QueryList,
  AfterContentInit,
  ViewEncapsulation,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectorRef,
  TemplateRef,
  ViewContainerRef,
  EmbeddedViewRef,
  NgZone,
  isDevMode, forwardRef, IterableDiffers, IterableDiffer, DoCheck,
} from '@angular/core';

import { coerceBooleanProperty, coerceNumberProperty } from '@angular/cdk/coercion';
import { CdkHeaderRowDef, CdkFooterRowDef, CdkRowDef } from '@angular/cdk/table';

import { UnRx } from '@pebula/utils';

import { EXT_API_TOKEN, PblNgridExtensionApi } from '../ext/table-ext-api';
import { PblNgridPluginController, PblNgridPluginContext } from '../ext/plugin-control';
import { PblNgridPaginatorKind } from '../paginator';
import { PblNgridSortDefinition, PblDataSource, DataSourceOf, createDS } from '../data-source/index';
import { PblCdkTableComponent } from './pbl-cdk-table/pbl-cdk-table.component';
import { resetColumnWidths } from './utils';
import { findCellDef } from './directives/cell-def';
import { PblColumn, PblColumnStore, PblMetaColumnStore, PblNgridColumnSet, PblNgridColumnDefinitionSet } from './columns';
import { PblNgridCellContext, PblNgridMetaCellContext, ContextApi, PblNgridContextApi } from './context/index';
import { PblNgridRegistryService } from './services/table-registry.service';
import { PblNgridConfigService } from './services/config';
import {
  DynamicColumnWidthLogic,
  BoxModelSpaceStrategy,
  DYNAMIC_PADDING_BOX_MODEL_SPACE_STRATEGY,
  DYNAMIC_MARGIN_BOX_MODEL_SPACE_STRATEGY
} from './col-width-logic/dynamic-column-width';
import { ColumnApi, AutoSizeToFitOptions } from './column-api';
import { PblCdkVirtualScrollViewportComponent } from './features/virtual-scroll/virtual-scroll-viewport.component';
import { PblNgridMetaRowService } from './meta-rows/index';
import { bindToDataSource } from './bind-to-datasource';

export function internalApiFactory(table: { _extApi: PblNgridExtensionApi; }) { return table._extApi; }
export function pluginControllerFactory(table: { _plugin: PblNgridPluginContext; }) { return table._plugin.controller; }
export function metaRowServiceFactory(table: { _extApi: PblNgridExtensionApi; }) { return table._extApi.metaRowService; }

@Component({
  selector: 'pbl-ngrid',
  templateUrl: './table.component.html',
  styleUrls: [ './table.component.scss' ],
  providers: [
    PblNgridRegistryService,
    {
      provide: PblNgridPluginController,
      useFactory: pluginControllerFactory,
      deps: [forwardRef(() => PblNgridComponent)],
    },
    {
      provide: EXT_API_TOKEN,
      useFactory: internalApiFactory,
      deps: [forwardRef(() => PblNgridComponent)],
    },
    {
      provide: PblNgridMetaRowService,
      useFactory: metaRowServiceFactory,
      deps: [forwardRef(() => PblNgridComponent)],
    }
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
@UnRx()
export class PblNgridComponent<T = any> implements AfterContentInit, AfterViewInit, DoCheck, OnChanges, OnDestroy {
  readonly self = this;

  /**
   * Set's the margin cell indentation strategy.
   * Margin cell indentation strategy apply margin to cells instead of paddings and defines all cell box-sizing to border-box.
   *
   * When not set (default) the table will use a padding cell indentation strategy.
   * Padding cell indentation strategy apply padding to cells and defines all cell box-sizing to content-box.
   */
  @Input() get boxSpaceModel(): 'padding' | 'margin' { return this._boxSpaceModel; };
  set boxSpaceModel(value: 'padding' | 'margin') {
    if (this._boxSpaceModel !== value) {
      this._boxSpaceModel = value;
      this._cellWidthLogic = value === 'margin'
        ? DYNAMIC_MARGIN_BOX_MODEL_SPACE_STRATEGY
        : DYNAMIC_PADDING_BOX_MODEL_SPACE_STRATEGY
      ;
      if (this.isInit) {
        // The UI changes are applied by toggle the `pbl-ngrid-margin-cell-box-model` CSS class.
        // This is managed through binding in `PblCdkTableComponent`.
        // After this change we need to measure the cell's width again so we trigger a resizeRows call.
        // We must run it deferred to allow binding to commit.
        this.ngZone.onStable.pipe(take(1)).subscribe( () => this.resizeColumns() );
      }
    }
  }
  private _boxSpaceModel: 'padding' | 'margin';
  private _cellWidthLogic: BoxModelSpaceStrategy;

  /**
   * Show/Hide the header row.
   * Default: true
   */
  @Input() get showHeader(): boolean { return this._showHeader; };
  set showHeader(value: boolean) {
    this._showHeader = coerceBooleanProperty(value);
  }
  _showHeader = true;

  /**
   * Show/Hide the footer row.
   * Default: false
   */
  @Input() get showFooter(): boolean { return this._showFooter; };
  set showFooter(value: boolean) {
    this._showFooter = coerceBooleanProperty(value);
  }
  _showFooter: boolean;

  /**
   * Set's the behavior of the table when tabbing.
   * The default behavior is none (rows and cells are not focusable)
   *
   * Note that the focus mode has an effect on other functions, for example a detail row will toggle (open/close) using
   * ENTER / SPACE only when focusMode is set to `row`.
   */
  @Input() focusMode: 'row' | 'cell' | 'none' | '' | false | undefined;

  /**
   * The name of the property that points to a UID on the object.
   * If not the, the table will use it's own identifier.
   *
   * Note that when not set some features might not work, especially around context state.
   */
  @Input() identityProp: string;

  /**
   * The table's source of data
   *
   * @remarks
   * The table's source of data, which can be provided in 2 ways:
   *
   * - DataSourceOf<T>
   * - PblDataSource<T>
   *
   * The table only works with `PblDataSource<T>`, `DataSourceOf<T>` is a shortcut for providing
   * the data array directly.
   *
   * `DataSourceOf<T>` can be:
   *
   * - Simple data array (each object represents one table row)
   * - Promise for a data array
   * - Stream that emits a data array each time the array changes
   *
   * When a `DataSourceOf<T>` is provided it is converted into an instance of `PblDataSource<T>`.
   *
   * To access the `PblDataSource<T>` instance use the `ds` property (readonly).
   *
   * It is highly recommended to use `PblDataSource<T>` directly, the datasource factory makes it easy.
   * For example, when an array is provided the factory is used to convert it to a datasource:
   *
   * ```typescript
   * const collection: T[] = [];
   * const pblDataSource = createDS<T>().onTrigger( () => collection ).create();
   * ```
   *
   * > This is a write-only (setter) property that triggers the `setDataSource` method.
   */
  @Input() set dataSource(value: PblDataSource<T> | DataSourceOf<T>) {
    if (value instanceof PblDataSource) {
      this.setDataSource(value);
    } else {
      this.setDataSource(createDS<T>().onTrigger( () => value || [] ).create());
    }
  }

  get ds(): PblDataSource<T> { return this._dataSource; };

  @Input() get usePagination(): PblNgridPaginatorKind | false { return this._pagination; }
  set usePagination(value: PblNgridPaginatorKind | false) {
    if ((value as any) === '') {
      value = 'pageNumber';
    }
    if ( value !== this._pagination ) {
      this._pagination = value;
      this.setupPaginator();
    }
  }

  @Input() get noCachePaginator(): boolean { return this._noCachePaginator; }
  set noCachePaginator(value: boolean) {
    value = coerceBooleanProperty(value);
    if (this._noCachePaginator !== value) {
      this._noCachePaginator = value;
      if (this.ds && this.ds.paginator) {
        this.ds.paginator.noCacheMode = value;
      }
    }
  }

  /**
   * The column definitions for this table.
   */
  @Input() columns: PblNgridColumnSet | PblNgridColumnDefinitionSet;

  @Input() set hideColumns(value: string[]) {
    this._hideColumns = value;
    this._hideColumnsDirty = true;
  }

  /**
   * A fallback height for "the inner scroll container".
   * The fallback is used only when it LOWER than the rendered height, so no empty gaps are created when setting the fallback.
   *
   * The "inner scroll container" is the area in which all data rows are rendered and all meta (header/footer) rows that are of type "row" or "sticky".
   * The "inner scroll container" is defined to consume all the height left after all external objects are rendered.
   * External objects can be fixed meta rows (header/footer), pagination row, action row etc...
   *
   * If the table does not have a height (% or px) the "inner scroll container" will always have no height (0).
   * If the table has a height, the "inner scroll container" will get the height left, which can also be 0 if there are a lot of external objects.
   *
   * To solve the no-height problem we use the fallbackMinHeight property.
   *
   * When virtual scroll is disabled and fallbackMinHeight is not set the table will set the "inner scroll container" height to show all rows.
   *
   * Note that when using a fixed (px) height for the table, if the height of all external objects + the height of the "inner scroll container" is greater then
   * the table's height a vertical scroll bar will show.
   * If the "inner scroll container"s height will be lower then it's rendered content height and additional vertical scroll bar will appear, which is, usually, not good.
   *
   * To avoid this, don't use fallbackMinHeight together with a fixed height for the table. Instead use fallbackMinHeight together with a min height for the table.
   */
  @Input() get fallbackMinHeight(): number { return this._fallbackMinHeight; }
  set fallbackMinHeight(value: number) {
    value = coerceNumberProperty(value);
    if (this._fallbackMinHeight !== value) {
      this._fallbackMinHeight = value;
    }
  }

  rowFocus: 0 | '' = '';
  cellFocus: 0 | '' = '';

  private _fallbackMinHeight = 0;
  private _dataSource: PblDataSource<T>;

  @ViewChild('beforeTable', { read: ViewContainerRef}) _vcRefBeforeTable: ViewContainerRef;
  @ViewChild('beforeContent', { read: ViewContainerRef}) _vcRefBeforeContent: ViewContainerRef;
  @ViewChild('afterContent', { read: ViewContainerRef}) _vcRefAfterContent: ViewContainerRef;
  @ViewChild('fbTableCell', { read: TemplateRef}) _fbTableCell: TemplateRef<PblNgridCellContext<T>>;
  @ViewChild('fbHeaderCell', { read: TemplateRef}) _fbHeaderCell: TemplateRef<PblNgridMetaCellContext<T>>;
  @ViewChild('fbFooterCell', { read: TemplateRef}) _fbFooterCell: TemplateRef<PblNgridMetaCellContext<T>>;
  @ViewChild(CdkRowDef) _tableRowDef: CdkRowDef<T>;
  @ViewChildren(CdkHeaderRowDef) _headerRowDefs: QueryList<CdkHeaderRowDef>;
  @ViewChildren(CdkFooterRowDef) _footerRowDefs: QueryList<CdkFooterRowDef>;

  get metaColumnIds(): PblColumnStore['metaColumnIds'] { return this._store.metaColumnIds; }
  get metaColumns(): PblColumnStore['metaColumns'] { return this._store.metaColumns; }
  get columnRowDef() { return { header: this._store.headerColumnDef, footer: this._store.footerColumnDef }; }
  /**
   * True when the component is initialized (after AfterViewInit)
   */
  readonly isInit: boolean;
  readonly columnApi: ColumnApi<T>;
  get contextApi(): PblNgridContextApi<T> { return this._extApi.contextApi; }

  get viewport(): PblCdkVirtualScrollViewportComponent | undefined { return this._viewport; }

  _cdkTable: PblCdkTableComponent<T>;
  private _store: PblColumnStore = new PblColumnStore();
  private _hideColumnsDirty: boolean;
  private _hideColumns: string[];
  private _colHideDiffer: IterableDiffer<string>;
  private _noDateEmbeddedVRef: EmbeddedViewRef<any>;
  private _paginatorEmbeddedVRef: EmbeddedViewRef<any>;
  private _pagination: PblNgridPaginatorKind | false;
  private _noCachePaginator = false;
  private _minimumRowWidth: string;
  private _viewport?: PblCdkVirtualScrollViewportComponent;
  private _plugin: PblNgridPluginContext;
  private _extApi: PblNgridExtensionApi<T>;

  constructor(injector: Injector, vcRef: ViewContainerRef,
              private elRef: ElementRef<HTMLElement>,
              private differs: IterableDiffers,
              private ngZone: NgZone,
              private cdr: ChangeDetectorRef,
              private config: PblNgridConfigService,
              public registry: PblNgridRegistryService) {
    const tableConfig = config.get('table');
    this.boxSpaceModel = tableConfig.boxSpaceModel;
    this.showHeader = tableConfig.showHeader;
    this.showFooter = tableConfig.showFooter;

    this.initExtApi();
    this.columnApi = new ColumnApi<T>(this, this._store, this._extApi);
    this.initPlugins(injector, elRef, vcRef);
  }

  ngDoCheck(): void {
    if (this._hideColumnsDirty) {
      this._hideColumnsDirty = false;
      const value = this._hideColumns;
      if (!this._colHideDiffer && value) {
        try {
          this._colHideDiffer = this.differs.find(value).create();
        } catch (e) {
          throw new Error(`Cannot find a differ supporting object '${value}. hideColumns only supports binding to Iterables such as Arrays.`);
        }
      }
    }
    if (this._colHideDiffer) {
      const hideColumns = this._hideColumns || [];
      const changes = this._colHideDiffer.diff(hideColumns);
      if (changes) {
        this._store.hidden = hideColumns;
        this._minimumRowWidth = '';

        // TODO(shlomiassaf) [perf, 4]: Right now we attach all columns, we can improve it by attaching only those "added" (we know them from "changes")
        this.attachCustomCellTemplates();
        this.attachCustomHeaderCellTemplates();
        this._cdkTable.syncRows('header');
      }
      if (!this._hideColumns) {
        this._colHideDiffer = undefined;
      }
    }
  }

  ngAfterContentInit(): void {
    // no need to unsubscribe, the reg service is per table instance and it will destroy when this table destroy.
    // Also, at this point initial changes from templates provided in the content are already inside so they will not trigger
    // the order here is very important, because component top of this table will fire life cycle hooks AFTER this component
    // so if we have a top level component registering a template on top it will not show unless we listen.
    this.registry.changes.subscribe( changes => {
      let tableCell = false;
      let headerFooterCell = false;
      for (const c of changes) {
        switch (c.type) {
          case 'tableCell':
            tableCell = true;
            break;
          case 'headerCell':
          case 'footerCell':
            headerFooterCell = true;
            break;
          case 'noData':
            this.setupNoData();
            break;
          case 'paginator':
            this.setupPaginator();
            break;
        }
      }
      if (tableCell) {
        this.attachCustomCellTemplates();
      }
      if (headerFooterCell) {
        this.attachCustomHeaderCellTemplates();
      }
    });
  }

  ngAfterViewInit(): void {
    this.invalidateColumns();

    Object.defineProperty(this, 'isInit', { value: true });
    this._plugin.emitEvent({ kind: 'onInit' });

    this.setupPaginator();

    // Adding a div before the footer row view reference, this div will be used to fill up the space between header & footer rows
    const div = document.createElement('div');
    div.classList.add('pbl-ngrid-empty-spacer')
    this._cdkTable._element.insertBefore(div, this._cdkTable._footerRowOutlet.elementRef.nativeElement);
    this.listenToResize();
  }

  ngOnChanges(changes: SimpleChanges): void {
    let processColumns = false;

    if (changes.focusMode) {
      this.rowFocus = this.focusMode === 'row' ? 0 : '';
      this.cellFocus = this.focusMode === 'cell' ? 0 : '';
    }

    if ( changes.columns && this.isInit ) {
      processColumns = true;
    }

    if ( processColumns === true ) {
      this.invalidateColumns();
    }
  }

  ngOnDestroy(): void {
    this._plugin.emitEvent({ kind: 'onDestroy' });
    this._plugin.destroy();
    if (this._viewport) {
      this._cdkTable.detachViewPort();
    }
  }

  trackBy(index: number, item: T): any {
    return index;
  }

  setSort(columnOrSortAlias: PblColumn | string, sort: PblNgridSortDefinition, skipUpdate = false): void {
    let column: PblColumn;
    if (typeof columnOrSortAlias === 'string') {
      column = this._store.columns.find( c => c.sortAlias ? c.sortAlias === columnOrSortAlias : (c.sort && c.id === columnOrSortAlias) );
      if (!column && isDevMode()) {
        console.warn(`Could not find column with sort alias "${columnOrSortAlias}`);
        return;
      }
    } else {
      column = columnOrSortAlias;
    }
    this.ds.setSort(column, sort, skipUpdate);
  }

  setDataSource(value: PblDataSource<T>): void {
    if (this._dataSource !== value) {
      // KILL ALL subscriptions for the previous datasource.
      if (this._dataSource) {
        UnRx.kill(this, this._dataSource);
      }

      const prev = this._dataSource;
      this._dataSource = value;
      this._cdkTable.dataSource = value as any;

      this.setupPaginator();
      this.setupNoData(false);

      // clear the context, new datasource
      this._extApi.contextApi.clear();

      this._plugin.emitEvent({
        kind: 'onDataSource',
        prev,
        curr: value
      });

      if ( value ) {
        if (isDevMode()) {
          value.onError.pipe(UnRx(this, value)).subscribe(console.error.bind(console));
        }

        // Run CD, scheduled as a micro-task, after each rendering
        value.onRenderDataChanging
          .pipe(
            filter( ({event}) => !event.isInitial && (event.pagination.changed || event.sort.changed || event.filter.changed)),
            // Context between the operations are not supported at the moment
            // Event for client side operations...
            tap( () => !this.identityProp && this._extApi.contextApi.clear() ),
            switchMap( () => value.onRenderedDataChanged.pipe(take(1), mapTo(this.ds.renderLength)) ),
            observeOn(asapScheduler),
            UnRx(this, value)
          )
          .subscribe( previousRenderLength => {
            // If the number of rendered items has changed the table will update the data and run CD on it.
            // so we only update the rows.
            const { cdkTable } = this._extApi;
            if (previousRenderLength === this.ds.renderLength) {
              cdkTable.syncRows(true);
            } else {
              cdkTable.syncRows('header', true);
              cdkTable.syncRows('footer', true);
            }
          });

        // Handling no data overlay
        // Handling fallback minimum height.
        value.onRenderedDataChanged
          .pipe(
            map( () => this.ds.renderLength ),
            startWith(null),
            pairwise(),
            tap( ([prev, curr]) => {
              const noDataShowing = !!this._noDateEmbeddedVRef;
              if ( (curr > 0 && noDataShowing) || (curr === 0 && !noDataShowing) ) {
                this.setupNoData();
              }
            }),
            observeOn(animationFrameScheduler), // ww want to give the browser time to remove/add rows
            UnRx(this, value)
          )
          .subscribe(() => {
            const el = this.viewport.elementRef.nativeElement;
            if (this.ds.renderLength > 0 && this._fallbackMinHeight > 0) {
              const h = Math.min(this._fallbackMinHeight, this.viewport.measureRenderedContentSize());
              el.style.minHeight = h + 'px';
            } else {
              // TODO: When viewport is disabled, we can skip the call to measureRenderedContentSize() and let the browser
              // do the job by setting `contain: unset` in `pbl-cdk-virtual-scroll-viewport`
              el.style.minHeight = this.viewport.enabled ? null : this.viewport.measureRenderedContentSize() + 'px';
            }
          });
      }
    }
  }

  /**
   * Invalidates the header, including a full rebuild of column headers
   */
  invalidateColumns(): void {
    const rebuildRows = this._store.allColumns.length > 0;
    this._store.invalidate(this.columns);
    this.attachCustomCellTemplates();
    this.attachCustomHeaderCellTemplates();
    this.cdr.markForCheck();
    this.cdr.detectChanges();

    // after invalidating the headers we now have optional header/headerGroups/footer rows added
    // we need to update the template with this data which will create new rows (header/footer)
    this.resetHeaderRowDefs();
    this.resetFooterRowDefs();

    this.cdr.markForCheck();

    /*  Now we will force clearing all data rows and creating them back again if this is not the first time we invalidate the columns...

        Why? first, some background:

        Invalidating the store will result in new `PblColumn` instances (cloned or completely new) held inside a new array (all arrays in the store are re-created on invalidate)
        New array and new instances will also result in new directive instances of `PblNgridColumnDef` for every column.

        Each data row has data cells with the `PblNgridCellDirective` directive (`pbl-ngrid-cell`).
        `PblNgridCellDirective` has a reference to `PblNgridColumnDef` through dependency injection, i.e. it will not update through change detection!

        Now, the problem:
        The `CdkTable` will cache rows and their cells, reusing them for performance.
        This means that the `PblNgridColumnDef` instance inside each cell will not change.
        So, creating new columns and columnDefs will result in stale cells with reference to dead instances of `PblColumn` and `PblNgridColumnDef`.

        One solution is to refactor `PblNgridCellDirective` to get the `PblNgridColumnDef` through data binding.
        While this will work it will put more work on each cell while doing CD and will require complex logic to handle each change because `PblNgridCellDirective`
        also create a context which has reference to a column thus a new context is required.
        Keeping track for all references will be difficult and bugs are likely to occur, which are hard to track.

        The simplest solution is to force the table to render all data rows from scratch which will destroy the cache and all cell's with it, creating new one's with proper reference.

        The simple solution is currently preferred because:

        - It is easier to implement.
        - It is easier to assess the impact.
        - It effects a single operation (changing to resetting columns) that rarely happen

        The only issue is with the `CdkTable` encapsulating the method `_forceRenderDataRows()` which is what we need.
        The workaround is to assign `multiTemplateDataRows` with the same value it already has, which will cause `_forceRenderDataRows` to fire.
        `multiTemplateDataRows` is a getter that triggers `_forceRenderDataRows` without checking the value changed, perfect fit.
        There is a risk with `multiTemplateDataRows` being changed...
     */
    if (rebuildRows) {
      this._cdkTable.multiTemplateDataRows = this._cdkTable.multiTemplateDataRows;
    }
    this._plugin.emitEvent({ kind: 'onInvalidateHeaders' });
  }

  /**
   * Updates the column sizes for all columns in the table based on the column definition metadata for each column.
   * The final width represent a static width, it is the value as set in the definition (except column without width, where the calculated global width is set).
   */
  resetColumnsWidth(options?: { tableMarkForCheck?: boolean; metaMarkForCheck?: boolean; }): void {
    resetColumnWidths(this._store.getStaticWidth(), this._store.columns, this._store.metaColumns, options);
  }

  /**
   * Update the size of all group columns in the table based on the size of their visible children (not hidden).
   * @param dynamicWidthLogic - Optional logic container, if not set a new one is created.
   */
  syncColumnGroupsSize(dynamicWidthLogic?: DynamicColumnWidthLogic): void {
    if (!dynamicWidthLogic) {
      dynamicWidthLogic = this._extApi.dynamicColumnWidthFactory();
    }

    // From all meta columns (header/footer/headerGroup) we filter only `headerGroup` columns.
    // For each we calculate it's width from all of the columns that the headerGroup "groups".
    // We use the same strategy and the same RowWidthDynamicAggregator instance which will prevent duplicate calculations.
    // Note that we might have multiple header groups, i.e. same columns on multiple groups with different row index.
    for (const g of this._store.getAllHeaderGroup()) {
      // We go over all columns because g.columns does not represent the current owned columns of the group
      // it is static, representing the initial state.
      // Only columns hold their group owners.
      // TODO: find way to improve iteration
      const colSizeInfos = this._store.columns.filter( c => !c.hidden && c.isInGroup(g)).map( c => c.sizeInfo );
      if (colSizeInfos.length > 0) {
        const groupWidth = dynamicWidthLogic.addGroup(colSizeInfos);
        g.minWidth = groupWidth;
        g.updateWidth(`${groupWidth}px`);
      } else {
        g.minWidth = undefined;
        g.updateWidth(`0px`);
      }
      if (g.columnDef) {
        g.columnDef.markForCheck();
      }
    }
  }

  resizeColumns(columns?: PblColumn[]): void {
    if (!columns) {
      columns = this._store.columns;
    }

    // stores and calculates width for columns added to it. Aggregate's the total width of all added columns.
    const rowWidth = this._extApi.dynamicColumnWidthFactory();
    this.syncColumnGroupsSize(rowWidth);

    // if this is a table without groups
    if (rowWidth.minimumRowWidth === 0) {
      rowWidth.addGroup(columns.map( c => c.sizeInfo ));
    }

    // if the max lock state has changed we need to update re-calculate the static width's again.
    if (rowWidth.maxWidthLockChanged) {
      resetColumnWidths(this._store.getStaticWidth(), this._store.columns, this._store.metaColumns, { tableMarkForCheck: true });
      this.resizeColumns(columns);
      return;
    }

    if (!this._minimumRowWidth ) {
      // We calculate the total minimum width of the table
      // We do it once, to set the minimum width based on the initial setup.
      // Note that we don't apply strategy here, we want the entire length of the table!
      this._cdkTable.minWidth = `${rowWidth.minimumRowWidth}px`;
    }

    this.ngZone.run( () => {
      this._cdkTable.syncRows('header');
      this._plugin.emitEvent({ kind: 'onResizeRow' });
    });
  }

  /**
   * Create an embedded view before or after the user projected content.
   */
  createView<C>(location: 'beforeTable' | 'beforeContent' | 'afterContent', templateRef: TemplateRef<C>, context?: C, index?: number): EmbeddedViewRef<C> {
    const vcRef = this.getInternalVcRef(location);
    const view = vcRef.createEmbeddedView(templateRef, context, index);
    view.detectChanges();
    return view;
  }

  /**
   * Remove an already created embedded view.
   * @param view - The view to remove
   * @param location - The location, if not set defaults to `before`
   * @returns true when a view was removed, false when not. (did not exist in the view container for the provided location)
   */
  removeView(view: EmbeddedViewRef<any>, location: 'beforeTable' | 'beforeContent' | 'afterContent'): boolean {
    const vcRef = this.getInternalVcRef(location);
    const idx = vcRef.indexOf(view);
    if (idx === -1) {
      return false;
    } else {
      vcRef.remove(idx);
      return true;
    }
  }

  /**
   * Resize all visible columns to fit content of the table.
   * @param forceFixedWidth - When true will resize all columns with absolute pixel values, otherwise will keep the same format as originally set (% or none)
   */
  autoSizeColumnToFit(options?: AutoSizeToFitOptions): void {
    const { innerWidth, outerWidth } = this.viewport;

    // calculate auto-size on the width without scroll bar and take box model gaps into account
    // TODO: if no scroll bar exists the calc will not include it, next if more rows are added a scroll bar will appear...
    this.columnApi.autoSizeToFit(outerWidth - (outerWidth - innerWidth), options);
  }

  findInitialRowHeight(): number {
    let rowElement: HTMLElement;
    if (this._cdkTable._rowOutlet.viewContainer.length) {
      const viewRef = this._cdkTable._rowOutlet.viewContainer.get(0) as EmbeddedViewRef<any>;
      rowElement = viewRef.rootNodes[0];
      const height = getComputedStyle(rowElement).height;
      return parseInt(height, 10);
    } else if (this._vcRefBeforeContent) {
      rowElement = this._vcRefBeforeContent.length > 0
        ? (this._vcRefBeforeContent.get(this._vcRefBeforeContent.length - 1) as EmbeddedViewRef<any>).rootNodes[0]
        : this._vcRefBeforeContent.element.nativeElement
      ;
      rowElement = rowElement.nextElementSibling as HTMLElement;
      rowElement.style.display = '';
      const height = getComputedStyle(rowElement).height;
      rowElement.style.display = 'none';
      return parseInt(height, 10);
    }
  }

  addClass(...cls: string[]): void {
    for (const c of cls) {
      this.elRef.nativeElement.classList.add(c);
    }
  }

  removeClass(...cls: string[]): void {
    for (const c of cls) {
      this.elRef.nativeElement.classList.remove(c);
    }
  }

  private initPlugins(injector: Injector, elRef: ElementRef<any>, vcRef: ViewContainerRef): void {
    // Create an injector for the extensions/plugins
    // This injector allow plugins (that choose so) to provide a factory function for runtime use.
    // I.E: as if they we're created by angular via template...
    // This allows seamless plugin-to-plugin dependencies without requiring specific template syntax.
    // And also allows auto plugin binding (app wide) without the need for template syntax.
    const pluginInjector = Injector.create({
      providers: [
        { provide: ViewContainerRef, useValue: vcRef },
        { provide: ElementRef, useValue: elRef },
        { provide: ChangeDetectorRef, useValue: this.cdr },
      ],
      parent: injector,
    });
    this._plugin = new PblNgridPluginContext(this, pluginInjector, this._extApi);
    bindToDataSource(this._plugin);
  }

  private listenToResize(): void {
    let resizeObserver: ResizeObserver;
    const ro$ = fromEventPattern<[ResizeObserverEntry[], ResizeObserver]>(
      handler => {
        if (!resizeObserver) {
          resizeObserver = new ResizeObserver(handler);
          resizeObserver.observe(this.elRef.nativeElement);
        }
      },
      handler => {
        if (resizeObserver) {
          resizeObserver.unobserve(this.elRef.nativeElement);
          resizeObserver.disconnect();
          resizeObserver = undefined;
        }
      }
    );

    // Skip the first emission
    // Debounce all resizes until the next complete animation frame without a resize
    // finally maps to the entries collection
    // SKIP:  We should skip the first emission (`skip(1)`) before we debounce, since its called upon calling "observe" on the resizeObserver.
    //        The problem is that some tables might require this because they do change size.
    //        An example is a table in a mat-tab that is hidden, the table will hit the resize one when we focus the tab
    //        which will require a resize handling because it's initial size is 0
    //        To workaround this, we only skip elements not yet added to the DOM, which means they will not trigger a resize event.
    let skipValue = document.contains(this.elRef.nativeElement) ? 1 : 0;

    ro$
      .pipe(
        skip(skipValue),
        debounceTime(0, animationFrameScheduler),
        UnRx(this),
      )
      .subscribe( (args: [ResizeObserverEntry[], ResizeObserver]) => {
        if (skipValue === 0) {
          skipValue = 1;
          const columns = this._store.columns;
          columns.forEach( c => c.sizeInfo.updateSize() );
        }
        this.onResize(args[0]);
      });
  }

  private onResize(entries: ResizeObserverEntry[]): void {
    if (this._viewport) {
      this._viewport.checkViewportSize();
    }
    this.resetColumnsWidth();
    this.resizeColumns();
  }

  private initExtApi(): void {
    let onInit: Array<() => void> = [];
    const extApi = {
      table: this,
      element: this.elRef.nativeElement,
      get cdkTable() { return extApi.table._cdkTable; },
      get events() { return extApi.table._plugin.events },
      get contextApi() {
        Object.defineProperty(this, 'contextApi', { value: new ContextApi<T>(extApi) });
        return extApi.contextApi;
      },
      get metaRowService() {
        Object.defineProperty(this, 'metaRowService', { value: new PblNgridMetaRowService<T>(extApi) });
        return extApi.metaRowService;
      },
      onInit: (fn: () => void) => {
        if (extApi.table.isInit) {
          fn();
        } else {
          if (onInit.length === 0) {
            let u = extApi.events.subscribe( e => {
              if (e.kind === 'onInit') {
                for (const onInitFn of onInit) {
                  onInitFn();
                }
                u.unsubscribe();
                onInit = u = undefined;
              }
            });
          }
          onInit.push(fn);
        }
      },
      columnStore: this._store,
      setViewport: (viewport) => this._viewport = viewport,
      dynamicColumnWidthFactory: (): DynamicColumnWidthLogic => {
        return new DynamicColumnWidthLogic(this._cellWidthLogic);
      }
    };
    this._extApi = extApi;
  }

  private setupNoData(force?: boolean): void {
    if (this._noDateEmbeddedVRef) {
      this.removeView(this._noDateEmbeddedVRef, 'beforeContent');
      this._noDateEmbeddedVRef = undefined;
    }
    if (force === false) {
      return;
    }

    const noData = this._dataSource && this._dataSource.renderLength === 0;
    if (noData) {
      this.addClass('pbl-ngrid-empty');
    } else {
      this.removeClass('pbl-ngrid-empty');
    }

    if (noData || force === true) {
      const noDataTemplate = this.registry.getSingle('noData');
      if (noDataTemplate) {
        this._noDateEmbeddedVRef = this.createView('beforeContent', noDataTemplate.tRef, { $implicit: this }, 0);
      }
    }
  }

  private getInternalVcRef(location: 'beforeTable' | 'beforeContent' | 'afterContent'): ViewContainerRef {
    return location === 'beforeTable'
      ? this._vcRefBeforeTable
      : location === 'beforeContent' ? this._vcRefBeforeContent : this._vcRefAfterContent
    ;
  }

  private setupPaginator(): void {
    const paginationKillKey = 'pblPaginationKillKey';
    const usePagination = this.ds && this.usePagination;

    if (usePagination) {
      this.ds.pagination = this._pagination;
      if (this.ds.paginator) {
        this.ds.paginator.noCacheMode = this._noCachePaginator;
      }
    }

    if (this.isInit) {
      UnRx.kill(this, paginationKillKey);
      if (this._paginatorEmbeddedVRef) {
        this.removeView(this._paginatorEmbeddedVRef, 'beforeContent');
        this._paginatorEmbeddedVRef = undefined;
      }
      if (usePagination) {
        const paginatorTemplate = this.registry.getSingle('paginator');
        if (paginatorTemplate) {
          this._paginatorEmbeddedVRef = this.createView('beforeContent', paginatorTemplate.tRef, { $implicit: this });
        }
      }
    }
  }

  private attachCustomCellTemplates(): void {
    for (const col of this._store.columns) {
      const cell = findCellDef(this.registry, col, 'tableCell', true);
      if ( cell ) {
        col.cellTpl = cell.tRef;
      } else {
        const defaultCellTemplate = this.registry.getMultiDefault('tableCell');
        col.cellTpl = defaultCellTemplate ? defaultCellTemplate.tRef : this._fbTableCell;
      }

      const editorCell = findCellDef(this.registry, col, 'editorCell', true);
      if ( editorCell ) {
        col.editorTpl = editorCell.tRef;
      } else {
        const defaultCellTemplate = this.registry.getMultiDefault('editorCell');
        col.editorTpl = defaultCellTemplate ? defaultCellTemplate.tRef : undefined;
      }
    }
  }

  private attachCustomHeaderCellTemplates(): void {
    const columns: Array<PblColumn | PblMetaColumnStore> = [].concat(this._store.columns, this._store.metaColumns);
    const defaultHeaderCellTemplate = this.registry.getMultiDefault('headerCell') || { tRef: this._fbHeaderCell };
    const defaultFooterCellTemplate = this.registry.getMultiDefault('footerCell') || { tRef: this._fbFooterCell };
    for (const col of columns) {
      if (col instanceof PblColumn) {
        const headerCellDef = findCellDef<T>(this.registry, col, 'headerCell', true) || defaultHeaderCellTemplate;
        const footerCellDef = findCellDef<T>(this.registry, col, 'footerCell', true) || defaultFooterCellTemplate;
        col.headerCellTpl = headerCellDef.tRef;
        col.footerCellTpl = footerCellDef.tRef;
      } else {
        if (col.header) {
          const headerCellDef = findCellDef(this.registry, col.header, 'headerCell', true) || defaultHeaderCellTemplate;
          col.header.template = headerCellDef.tRef;
        }
        if (col.headerGroup) {
          const headerCellDef = findCellDef(this.registry, col.headerGroup, 'headerCell', true) || defaultHeaderCellTemplate;
          col.headerGroup.template = headerCellDef.tRef;
        }
        if (col.footer) {
          const footerCellDef = findCellDef(this.registry, col.footer, 'footerCell', true) || defaultFooterCellTemplate;
          col.footer.template = footerCellDef.tRef;
        }
      }
    }
  }

  private resetHeaderRowDefs(): void {
    if (this._headerRowDefs) {
      // The table header (main, with column names) is always the last row def (index 0)
      // Because we want it to show last (after custom headers, group headers...) we first need to pull it and then push.

      this._cdkTable.clearHeaderRowDefs();
      const arr = this._headerRowDefs.toArray();
      arr.push(arr.shift());

      for (const rowDef of arr) {
        this._cdkTable.addHeaderRowDef(rowDef);
      }
    }
  }

  private resetFooterRowDefs(): void {
    if (this._footerRowDefs) {
      this._cdkTable.clearFooterRowDefs();
      for (const rowDef of this._footerRowDefs.toArray()) {
        this._cdkTable.addFooterRowDef(rowDef);
      }
    }
  }
}
