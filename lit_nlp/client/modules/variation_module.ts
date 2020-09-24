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
import {customElement, html, property} from 'lit-element';
import {computed, observable} from 'mobx';
import {classMap} from 'lit-html/directives/class-map';
import {styleMap} from 'lit-html/directives/style-map';

import {app} from '../core/lit_app';
import {LitModule} from '../core/lit_module';
import {TableData} from '../elements/table';
import {CallConfig, FacetMap, GroupedExamples, IndexedInput, LitName, ModelsMap, Spec} from '../lib/types';
import {doesOutputSpecContain, formatLabelNumber, findSpecKeys} from '../lib/utils';
import {GroupService} from '../services/group_service';
import {RegressionService, ClassificationService, SliceService} from '../services/services';
import {RegressionInfo} from '../services/regression_service';

import {buildMap} from './variation_module_dataset';
import {styles} from './variation_module.css';
import {styles as sharedStyles} from './shared_styles.css';

type Source = {
  modelName: string,
  specKey: LitName,
  fieldName: string
};

type ScoreReader = (id: string) => number | undefined;

type WordToDialect = {
  [word: string]: Dialect
};

type Dialect = {
  dialect: string,
  subregions: string,
  word: string
};

type PlainRow = {
  score?: number,
  d: IndexedInput,
  dialect: Dialect
};

/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression or multiclass classification model.
 */
@customElement('variation-module')
export class VariationModule extends LitModule {
  static title = 'Regional Variation';
  static numCols = 8;
  static template = () => {
    return html`<variation-module ></variation-module>`;
  };

  static shouldDisplayModule(modelSpecs: ModelsMap, datasetSpec: Spec) {
    return doesOutputSpecContain(modelSpecs, [
      'RegressionScore',
      'MulticlassPreds'
    ]);
  }

  // TODO
  static duplicateForModelComparison = true;

  static get styles() {
    return [sharedStyles, styles];
  }

  private readonly regressionService = app.getService(RegressionService);
  private readonly classificationService = app.getService(ClassificationService);

  @property({type: Object}) wordToDialect: WordToDialect = {};

  constructor() {
    super();
    this.wordToDialect = buildMap();
  }

  onSelect(selectedRowIndices: number[]) {
    const ids = selectedRowIndices
                    .map(index => this.appState.currentInputData[index]?.id)
                    .filter(id => id != null);
    this.selectionService.selectIds(ids);
  }

  onPrimarySelect(index: number) {
    const id = (index === -1)
      ? null
      : this.appState.currentInputData[index]?.id ?? null;
    this.selectionService.setPrimarySelection(id);
  }

  private readTableRowsFromService(ds: IndexedInput[], matches: WordToDialect, readScore: (id: string) => number | undefined): PlainRow[] {
    return ds.flatMap(d => {
      const score = readScore(d.id);
      const dialect = matches[d.id];
      const plainRow: PlainRow = {score, d, dialect};
      return [plainRow];
    });
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
        <mwc-icon style=${styles}>
          ${delta > 0 ? 'arrow_upward' : 'arrow_downward'}
        </mwc-icon>
        ${formatLabelNumber(Math.abs(delta))}
      </div>
    `;
  }

  formatDialectVariation(sentence: string, word: string) {
    // slice
    const start = sentence.indexOf(word);
    const end = start + word.length;
    const pre = sentence.slice(0, start);
    const highlight = sentence.slice(start, end);
    const post = sentence.slice(end);
    
    /// Styles, because classes won't apply within the table's shadow DOM
    const styles = styleMap({
      'padding': '3px',
      'background': '#fbc02d'
    });
    return html`
      <div>
        ${pre}
        <span style=${styles}>${highlight}</span>
        ${post}
      </div>
    `;
  }

  getScoreReaders(source: Source): ScoreReader[] {
    const {modelName, specKey, fieldName} = source;

    // Check for regression scores
    if (specKey === 'RegressionScore') {
      const readScoreForRegression: ScoreReader = id => {
        return this.regressionService.regressionInfo[id]?.[modelName]?.[fieldName]?.prediction;
      };
      return [readScoreForRegression];
    }

    // Also support multiclass for multiple classes or binary
    if (specKey === 'MulticlassPreds') {
      const spec = this.appState.getModelSpec(modelName);
      const predictionLabels = spec.output[fieldName].vocab!;
      const margins = this.classificationService.marginSettings[modelName] || {};

      const nullIdx = spec.output[fieldName].null_idx;
      if (predictionLabels.length === 2 && nullIdx != null) {
         const readScoreForMultiClassBinary: ScoreReader = id => {
           return this.classificationService.classificationInfo[id]?.[modelName]?.[fieldName]?.predictions[1 - nullIdx];
        };
        return [readScoreForMultiClassBinary];
      }

      // Multiple classes for multiple tables.
      predictionLabels.map((predictionLabel, index) => {
        const readScoreForMultipleClasses: ScoreReader = id => {
           return this.classificationService.classificationInfo[id]?.[modelName]?.[fieldName]?.predictions[index];
        };
        return readScoreForMultipleClasses;
      });
    }

    // should never reach
    return [];
  }

  render() {
    const matches:{[id: string]: Dialect} = {};
    var dialectsFoundMap = {};
    var ds: IndexedInput[] = [];
    const relevant = this.appState.currentInputData.filter((d: IndexedInput) => {
      const words = d.data.sentence.split(' ');
      words.forEach(word => {
        const dialect = this.wordToDialect[word];
        if (dialect != null) {
          matches[d.id] = dialect;
          dialectsFoundMap[dialect.dialect] = true;
          ds.push(d);
        }
      });
    });
    const dialectsFound = Object.keys(dialectsFoundMap);

    // Fan out by each (model, outputKey, fieldName)
    const sources = this.appState.currentModels.flatMap((modelName: string): Source[] => {
      const modelSpec = this.appState.getModelSpec(modelName);
      const outputSpecKeys: LitName[] = ['RegressionScore', 'MulticlassPreds'];
      return outputSpecKeys.flatMap(specKey => {
        const fieldNames = findSpecKeys(modelSpec.output, [specKey]);
        return fieldNames.map(fieldName => ({modelName, specKey, fieldName}));
       });
    });

    return this.renderGeneration(sources, ds, matches, dialectsFound);
  }

  renderGeneration(sources: Source[], ds: IndexedInput[], matches: WordToDialect, dialectsFound: string[]) {
    const dialectsMap = {};
    Object.values(this.wordToDialect).forEach(dialect => dialectsMap[dialect.dialect] = true);
    const percent = dialectsFound.length / Object.keys(dialectsMap).length;
    const styles = styleMap({
      color: 'darkorange',
      opacity: (1 - percent).toFixed(3)
    });
    return html`
      <div>
        <div class="info">
          <span>
            <b class="source">Regional variation:</b>
            Possible matches for <b style=${styles}>${Math.round(100 * percent)}% of dialects</b>,
            in ${ds.length === 1 ? '1 datapoint' : `${ds.length} datapoints`}
          </span>
          <span>
            Source: <a href="https://dare.wisc.edu/">American Regional English</a>
            based on ${Object.keys(this.wordToDialect).length} words
            from <a href="https://github.com/afshinrahimi/acl2017">DAREDS</a>
          </span>
         </div>
         <div>

         </div>
        ${this.renderTables(sources, ds, matches)}
      </div>
    `;
  }

  renderTables(sources: Source[], ds: IndexedInput[], matches: WordToDialect) {
    return sources.flatMap(source => {
      const scoreReaders = this.getScoreReaders(source);
      return scoreReaders.map(scoreReader => {
        const scoresForRows = this.readTableRowsFromService(ds, matches, scoreReader);
        const rows = this.formattedRows(scoresForRows);
        return this.renderTableForDeltas(source, rows, ds);
      });
    });
  }

  private formattedRows(scoresForRows: PlainRow[]): TableData[] {
    const BLANK = '-';
    return scoresForRows.map((scores: PlainRow) => {
      const {score, d, dialect}  = scores;
      const row: TableData = [
        score ? formatLabelNumber(score) : BLANK,
        dialect.word,
        dialect.dialect,
        dialect.subregions.split(',').join(' '),
        this.formatDialectVariation(d.data.sentence, dialect.word),
        d.id, // ID_COLUMN
        d.data.sentence // PLAIN_TEXT_COLUMN
      ];

      return row;
    });
  }

  private readonly SENTENCE_COLUMN = 4;
  private readonly ID_COLUMN = 5;
  private readonly PLAIN_TEXT_COLUMN = 6;

  renderTableForDeltas(source: Source, rows: TableData[], ds: IndexedInput[]) {
    const {fieldName} = source;

    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set(fieldName, true);
    columnVisibility.set('word', true);
    columnVisibility.set('dialect', true);
    columnVisibility.set('subregion', true);
    columnVisibility.set('sentence', true);
    columnVisibility.set('id', false);
    columnVisibility.set('sentence plain text', false);
    
    const onSelect = (selectedRowIndices: number[]) => {
      this.onSelect(selectedRowIndices);
    };
    const onPrimarySelect = (index: number) => {
      this.onPrimarySelect(index);
    };
    const getSortValue = (row: TableData, column: number) => {
      // sort on text instead of HTML
      if (column === this.SENTENCE_COLUMN) {
        return row[this.PLAIN_TEXT_COLUMN];
      }
      return row[column];
    }
    const getDataIndexFromRow = (row: TableData) => {
      const id = row[this.ID_COLUMN];
      return this.appState.getIndexById(id as string);
    };
    const primarySelectedIndex =
      this.appState.getIndexById(this.selectionService.primarySelectedId);

    // TODO(lit-dev) handle reference selection, if in compare examples mode.
    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName=${fieldName}
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
    'variation-module': VariationModule;
  }
}
