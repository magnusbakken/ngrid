// tslint:disable:member-ordering
/* @pebula-example:ex-1 ex-2 */
import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';
import { createDS, columnFactory} from '@pebula/ngrid';
import { Person, DemoDataSource } from '@pebula/apps/ngrid/shared';

@Component({
  selector: 'pbl-column-factory-grid-example-component',
  templateUrl: './column-factory.component.html',
  styleUrls: ['./column-factory.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnFactoryGridExampleComponent {
  columns = columnFactory()
    .default({ minWidth: 40 })
    .table(
      { prop: 'id', width: '40px' },
      { prop: 'name' },
      { prop: 'gender', width: '50px' },
      { prop: 'email', width: '150px' },
      { prop: 'country' },
      { prop: 'language' },
    )
    .header(
      { id: 'header1', label: 'Header 1', width: '25%'},
      { id: 'header2', label: 'Header 2'},
    )
    .headerGroup(
      { prop: 'name', span: 1, label: 'Name & Gender' },
    )
    .header(
      { id: 'header3', label: 'Header 3'},
    )
    .headerGroup(
      { prop: 'id', span: 2, label: 'ID, Name & Gender' },
      { prop: 'country', span: 1, label: 'Country & Language' },
    )
    .footer(
      { id: 'footer1', label: 'Footer 1', width: '25%'},
      { id: 'footer2', label: 'Footer 2'},
    )
    .footer(
      { id: 'footer3', label: 'Footer 3'},
    )
    .build();
  ds = createDS<Person>().onTrigger( () => this.datasource.getPeople(0, 5) ).create();

  constructor(private datasource: DemoDataSource) { }

}
/* @pebula-example:ex-1 ex-2 */
