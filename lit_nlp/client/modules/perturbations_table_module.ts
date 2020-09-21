/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// tslint:disable:no-new-decorators
import '@material/mwc-icon';

import * as d3 from 'd3';
import {customElement, html} from 'lit-element';
import {computed, observable} from 'mobx';
import {classMap} from 'lit-html/directives/class-map';
import {styleMap} from 'lit-html/directives/style-map';

import '../elements/text_diff';
import {app} from '../core/lit_app';
import {LitModule} from '../core/lit_module';
import {TableData} from '../elements/table';
import {CallConfig, FacetMap, GroupedExamples, IndexedInput, LitName, ModelsMap, Spec} from '../lib/types';
import {doesOutputSpecContain, formatLabelNumber, findSpecKeys} from '../lib/utils';
import {GroupService} from '../services/group_service';
import {DeltasService, RegressionService, ClassificationService, SliceService} from '../services/services';
import {RegressionInfo} from '../services/regression_service';
import {DeltaRow, DeltaInfo, Source} from '../services/deltas_service';

import {styles} from './perturbations_table_module.css';
import {styles as sharedStyles} from './shared_styles.css';


/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression or multiclass classification model.
 */
@customElement('perturbations-table-module')
export class PerturbationsTableModule extends LitModule {
  static title = 'Perturbations';
  static numCols = 8;
  static template = () => {
    return html`<perturbations-table-module></perturbations-table-module>`;
  };

  static shouldDisplayModule(modelSpecs: ModelsMap, datasetSpec: Spec) {
    return doesOutputSpecContain(modelSpecs, [
      'RegressionScore',
      'MulticlassPreds'
    ]);
  }

  static get styles() {
    return [sharedStyles, styles];
  }

  static duplicateForModelComparison = true;

  private readonly regressionService = app.getService(RegressionService);
  private readonly classificationService = app.getService(ClassificationService);
  private readonly deltasService = app.getService(DeltasService);

  /* These constants are for referring to table columns */
  private readonly SENTENCE_COLUMN = 0;
  private readonly DELTA_COLUMN = 4;
  private readonly ID_COLUMN = 5;
  private readonly NUMERIC_DELTA_COLUMN = 6;
  private readonly PLAIN_TEXT_COLUMN = 7;
  
  private onSelect(selectedRowIndices: number[]) {
    const ids = selectedRowIndices
                    .map(index => this.appState.currentInputData[index]?.id)
                    .filter(id => id != null);
    this.selectionService.selectIds(ids);
  }

  private onPrimarySelect(index: number) {
    const id = (index === -1)
      ? null
      : this.appState.currentInputData[index]?.id ?? null;
    this.selectionService.setPrimarySelection(id);
  }

  render() {
    const ds = this.appState.generatedDataPoints;
    if (ds.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }

    /* Consider classification and regression predictions, and fan out by
     * each (model, outputKey, fieldName)
     */
    return this.deltasService.sources.map((source, index) => {
      return this.renderHeaderAndTable(source, index);
    });

  }

  private renderHeaderAndTable(source: Source, sourceIndex: number) {
    const {fieldName} = source;

    const {generationKeys, deltaRows} = this.deltasService.deltaInfoFromSource(source);
    const tableRows = this.formattedTableRows(deltaRows);
    return html`
      <div>
        ${this.renderHeader(generationKeys.length, tableRows.length, sourceIndex)}
        ${this.renderTable(source, tableRows)}
        }
      </div>
    `;
  }

  private renderHeader(generationsCount: number, rowsCount: number, sourceIndex: number) {
    return html`
      <div class="info">
        <span>
          Generated ${rowsCount === 1 ? '1 datapoint' : `${rowsCount} datapoints`}
          from ${generationsCount === 1 ? '1 perturbation' : `${generationsCount} perturbations`}
        </span>
        ${this.renderNavigationStrip(sourceIndex)}
       </div>
    `;
  }

  private renderNavigationStrip(sourceIndex: number) {
    const sources = this.deltasService.sources;
    if (sources.length === 1) {
      return null;
    }

    const onChangeOffset = (delta: number) => {
      const infos = this.shadowRoot!.querySelectorAll('.info');
      const nextIndex = sourceIndex + delta;
      if (nextIndex < infos.length && nextIndex >= 0) {
        infos[nextIndex].scrollIntoView();
       }
    };

    const previousButton = html`
      <mwc-icon class='icon-button'
        @click=${() => {onChangeOffset(-1);}}>
        chevron_left
      </mwc-icon>
    `;
    const nextButton = html`
      <mwc-icon class='icon-button'
        @click=${() => {onChangeOffset(1);}}>
        chevron_right
      </mwc-icon>
    `;
    const placeholderButton = html`<div class="icon-placeholder"> </div>`;
    return html`
      <span class="navigation-strip">
        ${sourceIndex + 1} of ${sources.length} fields
        <span class="navigation-buttons">
          ${sourceIndex - 1 >= 0 ? previousButton : placeholderButton}
          ${sourceIndex + 1 < sources.length ? nextButton : placeholderButton}
        </span>
      </span>
    `;
  }

  private formattedTableRows(deltaRows: DeltaRow[]): TableData[] {
    const BLANK = '-';
    const meanAbsDelta = d3.mean(deltaRows.filter(d => d.delta != null), d => {
      return Math.abs(d.delta!);
    });

    // Some columns are listed twice in different formats, one that's formatted
    // to be user-facing, and another with values that are hidden but sortable
    // for the table component.
    return deltaRows.map((deltaRow: DeltaRow) => {
      const {before, after, delta, d, parent}  = deltaRow;
      const row: TableData = [
        this.renderSentenceWithDiff(parent.data.sentence, d.data.sentence), // SENTENCE_COLUMN
        d.meta.rule ? d.meta.rule : d.meta.source,
        before ? formatLabelNumber(before) : BLANK,
        after ? formatLabelNumber(after) : BLANK,
        delta ? this.renderDeltaCell(delta, meanAbsDelta) : BLANK, // DELTA_COLUMN
        d.id, // ID_COLUMN
        delta ? delta : 0, // NUMERIC_DELTA_COLUMN
        d.data.sentence // PLAIN_TEXT_COLUMN
      ];

      return row;
    });
  }

  private renderSentenceWithDiff(before: string, after: string) {
    return html`
      <lit-text-diff
        beforeText=${before}
        afterText=${after}
        .includeBefore=${false}
      /></lit-text-diff>
    `;
  }

  private renderDeltaCell(delta: number, meanAbsDelta?: number) {
    /// Styles, because classes won't apply within the table's shadow DOM
    const opacity = meanAbsDelta ? Math.abs(delta) / meanAbsDelta : 0.5;
    const styles = styleMap({
      'font-size': '12px',
      'opacity': opacity.toFixed(3),
      'vertical-align': 'middle'
    });
    return html`
      <div>
        <mwc-icon class="HUGE" style=${styles}>
          ${delta > 0 ? 'arrow_upward' : 'arrow_downward'}
        </mwc-icon>
        ${formatLabelNumber(Math.abs(delta))}
      </div>
    `;
  }

  private renderTable(source: Source, rows: TableData[]) {
    const {fieldName} = source;

    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('generated sentence', true);
    columnVisibility.set(`source`, true);
    columnVisibility.set(`parent ${fieldName}`, true);
    columnVisibility.set(`${fieldName}`, true);
    columnVisibility.set('delta', true);
    columnVisibility.set('id', false);
    columnVisibility.set('numeric_delta', false);
    columnVisibility.set('sentence plain text', false);
    
    const onSelect = (selectedRowIndices: number[]) => {
      this.onSelect(selectedRowIndices);
    };
    const onPrimarySelect = (index: number) => {
      this.onPrimarySelect(index);
    };
    
    /* Adjust how sorting is done, for columns that include non-sortable
     * values (eg, HTML TemplateResult, or some other formatting)
     */
    const getSortValue = (row: TableData, column: number) => {
      if (column === this.SENTENCE_COLUMN) {
        return row[this.PLAIN_TEXT_COLUMN];
      } else if (column === this.DELTA_COLUMN) {
        return row[this.NUMERIC_DELTA_COLUMN];
      }
      return row[column];
    }
    const getDataIndexFromRow = (row: TableData) => {
      const id = row[this.ID_COLUMN];
      return this.appState.getIndexById(id as string);
    };
    const primarySelectedIndex =
      this.appState.getIndexById(this.selectionService.primarySelectedId);

    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName="delta"
          .defaultSortAscending=${false}
          .columnVisibility=${columnVisibility}
          .data=${rows}
          .selectedIndices=${this.selectionService.selectedRowIndices}
          .primarySelectedIndex=${primarySelectedIndex}
          .onSelect=${onSelect}
          .onPrimarySelect=${onPrimarySelect}
          .getDataIndexFromRow=${getDataIndexFromRow}
          .getSortValue=${getSortValue}
        ></lit-data-table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-table-module': PerturbationsTableModule;
  }
}
