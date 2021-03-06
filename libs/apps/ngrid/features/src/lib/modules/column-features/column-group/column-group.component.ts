/* @pebula-example:ex-1 ex-2  */
import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { PblNgridComponent, createDS, columnFactory } from '@pebula/ngrid';
import { Person, DemoDataSource } from '@pebula/apps/ngrid/shared';

@Component({
  selector: 'pbl-column-group-grid-example-component',
  templateUrl: './column-group.component.html',
  styleUrls: ['./column-group.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnGroupGridExampleComponent {

  /* @pebula-ignore:ex-2 */
  columns1 = columnFactory()
    .table(
      { prop: 'id', width: '40px' },
      { prop: 'name' },
      { prop: 'gender', width: '50px' },
      { prop: 'email', width: '150px' },
      { prop: 'country' },
      { prop: 'language' },
    )
    .headerGroup(
      { prop: 'name', span: 1, label: 'Name & Gender' },
      { prop: 'country', span: 1, label: 'Country & Language' },
    )
    .build();
  ds1 = createDS<Person>().onTrigger( () => this.datasource.getPeople(0, 500) ).create();
  /* @pebula-ignore:ex-2 */
  /* @pebula-ignore:ex-1 */
  columns2 = columnFactory()
    .table(
      { prop: 'id', width: '40px' },
      { prop: 'name' },
      { prop: 'gender', width: '50px' },
      { prop: 'email', width: '150px' },
      { prop: 'country' },
      { prop: 'language' },
    )
    .headerGroup(
      { prop: 'name', span: 1, label: 'Name & Gender' },
      { prop: 'country', span: 1, label: 'Country & Language' },
    )
    .header(
      { id: 'header1', label: 'Header 1', width: '25%'},
      { id: 'header2', label: 'Header 2'},
      { id: 'header3', label: 'Header 3', width: '25%'},
    )
    .headerGroup(
      { prop: 'id', span: 2, label: 'ID, Name & Gender' },
      { prop: 'country', span: 1, label: 'Country & Language' },
    )
    .build();
  ds2 = createDS<Person>().onTrigger( () => this.datasource.getPeople(0, 500) ).create();
  /* @pebula-ignore:ex-1 */

  constructor(private datasource: DemoDataSource) {}
}
/* @pebula-example:ex-1 ex-2 */
