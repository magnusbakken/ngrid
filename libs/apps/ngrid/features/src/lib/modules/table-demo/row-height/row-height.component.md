# Row Height

By default the row height is not limited, there is a minimum row height set via CSS (`mix-height`).

i> The minimum limit for a row size can be changed via CSS overrides. The default is 48px

<docsi-mat-example-with-source title="Row Height" contentClass="table-height-300 mat-elevation-z7" [query]="[{section: 'ex-1'}]">
  <!--@pebula-example:ex-1-->
  <pbl-ngrid blockUi [dataSource]="ds1" [columns]="columns"></pbl-ngrid>
  <!--@pebula-example:ex-1-->
</docsi-mat-example-with-source>

Because it's CSS, the maximum row height might be controlled by CSS (`max-height`), let's try:

<docsi-mat-example-with-source title="Limit row height with cell overflow" contentClass="table-height-300 mat-elevation-z7" [query]="[{section: 'ex-2'}]">
  <!--@pebula-example:ex-2-->
  <pbl-ngrid class="max-row-height-72" blockUi [dataSource]="ds2" [columns]="columns"></pbl-ngrid>
  <!--@pebula-example:ex-2-->
</docsi-mat-example-with-source>

Not what we wanted...

The problem when setting `max-width` is overflow, when the cell's content view height is greater then the maximum width we set.
To solve this the global theme comes with CSS helpers to make sure content does not overflow:

- .pbl-ngrid-cell-ellipsis
- .pbl-ngrid-header-cell-ellipsis
- .pbl-ngrid-footer-cell-ellipsis

When applying one or more of the above, when a relevant cell overflows, the overflow content is hidden and an ellipsis is added.

But now the maximum height has no effect, the height can be controlled only through the `min-height` property.

<docsi-mat-example-with-source title="Limit row height with cell overflow" contentClass="table-height-300 mat-elevation-z7" [query]="[{section: 'ex-2'}]">
  <!--@pebula-example:ex-3-->
  <pbl-ngrid class="pbl-ngrid-cell-ellipsis max-row-height-72 min-row-height-64" blockUi [dataSource]="ds3" [columns]="columns" vScrollAuto="72"></pbl-ngrid>
  <!--@pebula-example:ex-3-->
</docsi-mat-example-with-source>

W> Using `min-height` to change the table's row height is not recommended, instead apply the overflow helpers and use cell's to determine heights.
This will help avoiding gaps between a cell and it's parent row.
