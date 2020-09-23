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

import {customElement, html} from 'lit-element';
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

import {styles} from './generated_diff_module.css';
import {styles as sharedStyles} from './shared_styles.css';

type Source = {
  modelName: string,
  specKey: LitName,
  fieldName: string
};

type ScoreReader = (id: string) => number | undefined;

type DeltaRow = {
  before?: number,
  after?: number,
  d: IndexedInput,
  parent: IndexedInput
};

/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression or multiclass classification model.
 */
@customElement('generated-diff')
export class GeneratedDiffModule extends LitModule {
  static title = 'Counterfactual Changes';
  static numCols = 8;
  static template = () => {
    return html`<generated-diff ></generated-diff>`;
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

  /**
   * Filter to only generated data points.
  */
  @computed
  private get generatedDataPoints() {
    return this.appState.currentInputData.filter((d: IndexedInput) => d.meta.added);
  }

  /**
   * Get a list of each time a generator was run, and the data points generated.
  */
  @computed
  private get generations() {
    const groupedByGeneration: {[key: string]: IndexedInput[]} = {};
    this.generatedDataPoints.forEach((d: IndexedInput) => {
      const {source, creationId, parentId} = d.meta;
      const key = [source || '(unknown)', creationId || ('unknown')].join('-');
      groupedByGeneration[key] = (groupedByGeneration[key] || []).concat([d]);
    });

    return Object.keys(groupedByGeneration).map(generationKey => {
      return {
        generationKey: generationKey,
        ds: groupedByGeneration[generationKey]
      };
    });
  }

  /**
   * Read values from the regression or classification service if they're available,
     and format them for a table.
  */
  private getTableRows(source: Source, scoreReader: ScoreReader, ds: IndexedInput[]) {
    
  }

  private formattedDeltaRows(scoresForRows: DeltaRow[]): any[] {
    const BLANK = '-';
    return scoresForRows.map((scores: DeltaRow) => {
      const {before, after, d, parent}  = scores;
      const delta = (before != null && after != null)
        ? after - before
        : null;
      return [
        this.formattedSentence(parent.data.sentence, d.data.sentence),
        before ? formatLabelNumber(before) : BLANK,
        after ? formatLabelNumber(after) : BLANK,
        delta ? formatLabelNumber(delta) : BLANK
      ];
    });
  }

  private formattedSentence(before: string, after: string) {
    // Split sentence text naively
    var i = 0;
    while (before[i] === after[i]) {
      i += 1;
    }
    var j = 0;
    while (before[before.length - j - 1] === after[after.length - j - 1]) {
      j += 1;
    }
    var start = i;
    var end = after.length - j;

    /// Styles, because classes don't make sense within the Table's shadow DOM
    const styles = styleMap({
      'padding': '3px',
      'background': '#fbc02d'
    });
    return html`
      <div>
        ${after.slice(0, start)}
        <span style=${styles}>${after.slice(start, end)}</span>
        ${after.slice(end)}
      </div>
    `;
  }

  private readTableRowsFromService(ds: IndexedInput[], readScore: (id: string) => number | undefined): DeltaRow[] {
    return ds.flatMap(d => {
      const parent = this.appState.getCurrentInputDataById(d.meta.parentId);
      if (parent == null) return [];
      
      const before = readScore(parent.id);
      const after = readScore(d.id);
      const deltaRow: DeltaRow = {before, after, d, parent};
      return [deltaRow];
    });
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
    if (this.generatedDataPoints.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }

    // Fan out by each (model, outputKey, fieldName)
    const sources = this.appState.currentModels.flatMap((modelName: string): Source[] => {
      const modelSpec = this.appState.getModelSpec(modelName);
      const outputSpecKeys: LitName[] = ['RegressionScore', 'MulticlassPreds'];
      return outputSpecKeys.flatMap(specKey => {
        const fieldNames = findSpecKeys(modelSpec.output, [specKey]);
        return fieldNames.map(fieldName => ({modelName, specKey, fieldName}));
       });
    });

    return html`
      <div>
        ${this.generations.map(({generationKey, ds}, index) => {
          return this.renderGeneration(sources, generationKey, ds, index);
        })}
      </div>
    `;
  }

  renderGeneration(sources: Source[], key: string, ds: IndexedInput[], generationIndex: number) {
    return html`
      <div>
        <div class="info">
          <b class="source">${ds[0].meta.source}</b>
          generated ${ds.length === 1 ? '1 datapoint' : `${ds.length} datapoints`}
          ${this.renderNavigationStrip(generationIndex)}
         </div>
        ${this.renderTables(sources, ds)}
      </div>
    `;
  }

  renderNavigationStrip(generationIndex: number) {
    const onChangeOffset = (delta: number) => {
      const infos = this.shadowRoot!.querySelectorAll('.info');
      const nextIndex = generationIndex + delta;
      if (nextIndex < infos.length && nextIndex >= 0) {
        infos[nextIndex].scrollIntoView();
       }
    };
    if (this.generations.length === 1) {
      return null;
    }

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
      <span class="navigation-buttons">
        ${generationIndex - 1 >= 0 ? previousButton : placeholderButton}
        ${generationIndex + 1 < this.generations.length ? nextButton : placeholderButton}
      </span>
    `;
  }

  renderTables(sources: Source[], ds: IndexedInput[]) {
    return sources.flatMap(source => {
      const scoreReaders = this.getScoreReaders(source);
      return scoreReaders.map(scoreReader => {
        const scoresForRows = this.readTableRowsFromService(ds, scoreReader);
        const rows = this.formattedDeltaRows(scoresForRows);
        return this.renderTableForDeltas(source, rows);
      });
    });
  }

  renderTableForDeltas(source: Source, rows: any[]) {
    const {fieldName} = source;

    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('generated sentence', true);
    columnVisibility.set(`parent ${fieldName}`, true);
    columnVisibility.set(`${fieldName}`, true);
    columnVisibility.set('delta', true);
    
    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName="delta"
          .defaultSortAscending=${false}
          .columnVisibility=${columnVisibility}
          .data=${rows}
            selectionDisabled
        ></lit-data-table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'generated-diff': GeneratedDiffModule;
  }
}
