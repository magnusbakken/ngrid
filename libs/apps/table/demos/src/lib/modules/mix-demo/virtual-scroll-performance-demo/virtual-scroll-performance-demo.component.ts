import { Component, ViewEncapsulation, ChangeDetectorRef, ViewChild } from '@angular/core';

import { createDS, columnFactory, NegTableComponent, KillOnDestroy } from '@neg/table';
import {  Customer, DemoDataSource } from '@neg/apps/table/shared';
import { MatRadioChange } from '@angular/material';

const COUNTRY_GETTER = {
  currency: row => COUNTRY_GETTER.data.countries[row.country].currencies[0],
  flagAndCountry: row => COUNTRY_GETTER.flag(row) + ' ' + COUNTRY_GETTER.name(row),
  name: row => COUNTRY_GETTER.data.countries[row.country].name,
  flag: row => COUNTRY_GETTER.data.countries[row.country].emoji,
  data: undefined as any
}

const ACCOUNT_BALANCE_TYPE = { name: 'accountBalance', data: { neg: 'balance-negative', pos: 'balance-positive', format: '1.0-2', meta: COUNTRY_GETTER } };

function createColumns(noType = false) {
  const getType = <T>(type: T): T | undefined => noType ? undefined : type;

  return columnFactory()
    .default({ minWidth: 100, resize: true })
    .table(
      { prop: 'drag_and_drop_handle', type: 'drag_and_drop_handle', minWidth: 48, maxWidth: 48 },
      { prop: 'selection', width: '48px' },
      { prop: 'id', width: '40px' },
      { prop: 'name', sort: true, reorder: true },
      { prop: 'country', headerType: getType('country'), type: getType({ name: 'flagAndCountry', data: COUNTRY_GETTER }), width: '150px' },
      { prop: 'jobTitle'  },
      { prop: 'accountId'  },
      { prop: 'accountType', reorder: true },
      { prop: 'primeAccount', type: getType('visualBool'), width: '24px' },
      { prop: 'creditScore', type: getType('starRatings'), width: '50px' },
      { prop: 'balance', type: getType(ACCOUNT_BALANCE_TYPE), sort: true },
      ...Array.from(new Array(12)).map( (item, idx) => ({prop: `monthlyBalance.${idx}`, type: getType(ACCOUNT_BALANCE_TYPE), sort: true }) )
    )
    .headerGroup(
      {
        prop: 'name',
        span: 2,
        label: 'Customer Info',
      },
      {
        prop: 'accountId',
        span: 4,
        label: 'Account Info',
      },
      {
        prop: 'monthlyBalance.0',
        label: 'Monthly Balance',
      }
    )
    .footer(
      // { sticky: true },
      { id: 'reref', label: 'FOOTER' },
    )
    .footer(
      // { sticky: true },
      { id: 'rere123f', label: 'FOOTER2' },
    )
    .build();
}

@Component({
  selector: 'neg-virtual-scroll-performance-demo',
  templateUrl: './virtual-scroll-performance-demo.component.html',
  styleUrls: ['./virtual-scroll-performance-demo.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
@KillOnDestroy()
export class VirtualScrollPerformanceDemoTableExampleComponent {

  columns = createColumns();
  dataSource = this.getDatasource();

  collectionSize = 10000;

  wheelMode: 'passive' | 'blocking' | number = 'passive';
  wheelModeState: 'passive' | 'blocking' | 'threshold' = 'passive';
  plainColumns = false;
  showTable = true;
  hideColumns: string[] = [];

  @ViewChild(NegTableComponent) negTable: NegTableComponent<any>;

  constructor(private datasource: DemoDataSource, private cdr: ChangeDetectorRef) {
    datasource.getCountries().then( c => COUNTRY_GETTER.data = c );
  }

  toggleColumn(coll: string[], id: string): void {
    const idx = coll.indexOf(id);
    if (idx === -1) {
      coll.push(id);
    } else {
      coll.splice(idx, 1);
    }
  }

  togglePlainColumns() {
    this.plainColumns = !this.plainColumns;
    this.showTable = false;
    setTimeout(() => {
      this.showTable = true;
      this.columns = createColumns(this.plainColumns);
      this.dataSource = this.getDatasource();
      this.cdr.detectChanges();
    }, 100);
  }

  collectionSizeChange(value: number): void {
    this.collectionSize = value;
    this.dataSource.refresh();
  }

  wheelModeChange(event: MatRadioChange): void {
    this.wheelModeState = event.value;
    switch (this.wheelModeState) {
      case 'passive':
      case 'blocking':
        this.wheelMode = this.wheelModeState;
        break;
      default:
        this.wheelMode = 15;
        break;
    }
  }

  private getDatasource() {
    return createDS<Customer>()
      .onTrigger( () => this.datasource.getCustomers(0, this.collectionSize) )
      .create();
  }
}