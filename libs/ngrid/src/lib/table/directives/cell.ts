// tslint:disable:use-host-property-decorator
// tslint:disable:directive-selector
import { first } from 'rxjs/operators';
import {
  AfterViewInit,
  Component,
  Directive,
  ElementRef,
  DoCheck,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ViewContainerRef,
  ViewChild,
  NgZone,
  EmbeddedViewRef,
} from '@angular/core';
import { CdkHeaderCell, CdkCell, CdkFooterCell } from '@angular/cdk/table';

import { PblNgridComponent } from '../table.component';
import { uniqueColumnCss, uniqueColumnTypeCss, COLUMN_EDITABLE_CELL_CLASS } from '../circular-dep-bridge';
import { COLUMN, PblMetaColumn, PblColumn, PblColumnGroup } from '../columns';
import { MetaCellContext, PblNgridMetaCellContext } from '../context/index';
import { PblNgridMultiRegistryMap } from '../services/table-registry.service';
import { PblNgridColumnDef } from './column-def';
import { PblNgridDataHeaderExtensionContext, PblNgridMultiComponentRegistry, PblNgridMultiTemplateRegistry } from './registry.directives';

const HEADER_GROUP_CSS = `pbl-header-group-cell`;
const HEADER_GROUP_PLACE_HOLDER_CSS = `pbl-header-group-cell-placeholder`;

function initCellElement(el: HTMLElement, column: COLUMN): void {
  el.classList.add(uniqueColumnCss(column.columnDef));
  if (column.type) {
    el.classList.add(uniqueColumnTypeCss(column.type));
  }
  if (column.css) {
    const css = column.css.split(' ');
    for (const c of css) {
      el.classList.add(c);
    }
  }
}

function initDataCellElement(el: HTMLElement, column: PblColumn): void {
  if (column.editable && column.editorTpl) {
    el.classList.add(COLUMN_EDITABLE_CELL_CLASS);
  }
}

const lastDataHeaderExtensions = new Map<PblNgridComponent<any>, PblNgridMultiRegistryMap['dataHeaderExtensions'][]>();

/**
 * Header cell component.
 * The header cell component will render the header cell template and add the proper classes and role.
 *
 * It is also responsible for creating and managing the any `dataHeaderExtensions` registered in the registry.
 * These extensions add features to the cells either as a template instance or as a component instance.
 * Examples: Sorting behavior, drag&drop/resize handlers, menus etc...
 */
@Component({
  selector: 'pbl-ngrid-header-cell',
  host: {
    class: 'pbl-ngrid-header-cell',
    role: 'columnheader',
  },
  template: `<ng-container #vcRef></ng-container>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class PblNgridHeaderCellComponent<T extends COLUMN = COLUMN> extends CdkHeaderCell implements DoCheck, AfterViewInit {
  @ViewChild('vcRef', { read: ViewContainerRef }) vcRef: ViewContainerRef;

  private el: HTMLElement;

  constructor(public readonly columnDef: PblNgridColumnDef<T>,
              public readonly table: PblNgridComponent<any>,
              public readonly elementRef: ElementRef,
              private zone: NgZone) {
    super(columnDef, elementRef);
    const column = columnDef.column;
    const el = this.el = elementRef.nativeElement;

    if (column instanceof PblColumnGroup) {
      el.classList.add(HEADER_GROUP_CSS);
      if (column.placeholder) {
        el.classList.add(HEADER_GROUP_PLACE_HOLDER_CSS);
      }
    }
  }

  ngAfterViewInit(): void {
    const col: COLUMN = this.columnDef.column;
    const { vcRef } = this;
    let view: EmbeddedViewRef<PblNgridMetaCellContext<any, PblMetaColumn | PblColumn>>;

    if (col instanceof PblColumn) {
      const context = new PblNgridDataHeaderExtensionContext(this as PblNgridHeaderCellComponent<PblColumn>, vcRef.injector);
      view = vcRef.createEmbeddedView(col.headerCellTpl, context);
      this.zone.onStable
        .pipe(first())
        .subscribe( () => {
          this.runHeaderExtensions(context, view as EmbeddedViewRef<PblNgridMetaCellContext<any, PblColumn>>);
          const v = vcRef.get(0);
          // at this point the view might get destroyed, its possible...
          if (!v.destroyed) {
            v.detectChanges();
          }
        });
    } else {
      view = vcRef.createEmbeddedView(col.template, new MetaCellContext(col, this.table));
    }

    view.detectChanges();
    this.columnDef.applyWidth(this.el);
    initCellElement(this.el, col);
  }

  // TODO: smart diff handling... handle all diffs, not just width, and change only when required.
  ngDoCheck(): void {
    if (this.columnDef.isDirty) {
      this.columnDef.applyWidth(this.el);
    }
  }

  protected runHeaderExtensions(context: PblNgridDataHeaderExtensionContext, view: EmbeddedViewRef<PblNgridMetaCellContext<any, PblColumn>>): void {
    // we collect the first header extension for each unique name only once per table instance
    let extensions = lastDataHeaderExtensions.get(this.table);
    if (!extensions) {
      const dataHeaderExtensions = new Map<string, any>();
      let registry = this.table.registry;
      while (registry) {
        const values = registry.getMulti('dataHeaderExtensions');
        if (values) {
          for (const value of values) {
            if (!dataHeaderExtensions.has(value.name)) {
              dataHeaderExtensions.set(value.name, value);
            }
          }
        }
        registry = registry.parent;
      }
      extensions = Array.from(dataHeaderExtensions.values());
      lastDataHeaderExtensions.set(this.table, extensions);
      // destroy it on the next turn, we know all cells will render on the same turn.
      this.zone.onStable.pipe(first()).subscribe( () => lastDataHeaderExtensions.delete(this.table) );
    }

    let { rootNodes } = view;

    for (const ext of extensions) {
      if (!ext.shouldRender || ext.shouldRender(context)) {
        if (ext instanceof PblNgridMultiTemplateRegistry) {
          const extView = this.vcRef.createEmbeddedView(ext.tRef, context);
          extView.markForCheck();
        } else if (ext instanceof PblNgridMultiComponentRegistry) {
          rootNodes = this.createComponent(ext, context, rootNodes);
        }
      }
    }
  }

  protected createComponent(ext: PblNgridMultiComponentRegistry<any, "dataHeaderExtensions">, context: PblNgridDataHeaderExtensionContext, rootNodes: any[]): any[] {
    const factory = ext.getFactory(context);
    const projectedContent: any[][] = [];

    if (ext.projectContent) {
      projectedContent.push(rootNodes);
    }

    const cmpRef = this.vcRef.createComponent(factory, 0, null, projectedContent);

    if (ext.projectContent) {
      rootNodes = [ cmpRef.location.nativeElement ];
    }

    if (ext.onCreated) {
      ext.onCreated(context, cmpRef);
    }

    return rootNodes;
  }
}

/** Cell template container that adds the right classes and role. */
@Directive({
  selector: 'pbl-ngrid-cell',
  host: {
    'class': 'pbl-ngrid-cell',
    'role': 'gridcell',
  },
  exportAs: 'pblNgridCell',
})
export class PblNgridCellDirective extends CdkCell implements DoCheck {

  private el: HTMLElement;

  constructor(private columnDef: PblNgridColumnDef, elementRef: ElementRef) {
    super(columnDef, elementRef);
    this.el = elementRef.nativeElement;
    columnDef.applyWidth(this.el);
    initCellElement(this.el, columnDef.column);
    initDataCellElement(this.el, columnDef.column as PblColumn);
  }

  // TODO: smart diff handling... handle all diffs, not just width, and change only when required.
  ngDoCheck(): void {
    if (this.columnDef.isDirty) {
      this.columnDef.applyWidth(this.el);
    }
  }
}

@Directive({
  selector: 'pbl-ngrid-footer-cell',
  host: {
    'class': 'pbl-ngrid-footer-cell',
    'role': 'gridcell',
  },
 })
export class PblNgridFooterCellDirective extends CdkFooterCell implements DoCheck {
  private el: HTMLElement;

  constructor(private columnDef: PblNgridColumnDef, elementRef: ElementRef) {
    super(columnDef, elementRef);
    this.el = elementRef.nativeElement;
    const column = columnDef.column;
    columnDef.applyWidth(this.el);
    initCellElement(this.el, column);
  }

  // TODO: smart diff handling... handle all diffs, not just width, and change only when required.
  ngDoCheck(): void {
    if (this.columnDef.isDirty) {
      this.columnDef.applyWidth(this.el);
    }
  }
}
