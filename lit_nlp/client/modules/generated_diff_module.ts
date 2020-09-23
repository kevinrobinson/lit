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

// Each entry from the server.
interface MetricsResponse {
  'pred_key': string;
  'label_key': string;
  'metrics': {[key: string]: number};
}

// For rendering the table.
interface MetricsRow {
  'model': string;
  'selection': string;
  'predKey': string;
  'labelKey': string;
  // This is the name of the metrics subcomponent.
  'group': string;
  'numExamples': number;
  // These have arbitrary keys returned by subcomponents on the backend.
  // We'll collect all the field names before rendering the table.
  'metrics': {[key: string]: number};
  'facets'?: FacetMap;
}

interface GroupedMetrics {
  [group: string]: MetricsResponse[];
}

interface GroupedMetricsForDataset {
  'metrics': GroupedMetrics[];
  'name': string;
  'length': number;
  'facets'?: FacetMap;
}

interface TableHeaderAndData {
  'header': string[];
  'data': TableData[];
}

/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression model.
 */
@customElement('generated-diff')
export class GeneratedDiffModule extends LitModule {
  static title = 'Counterfactual Changes';
  static numCols = 8;
  static template = () => {
    return html`<generated-diff ></generated-diff>`;
  };

  static supportedPredTypes: LitName[] =
      ['RegressionScore'];

  static duplicateForModelComparison = true;

  static get styles() {
    return [sharedStyles, styles];
  }

  private readonly regressionService = app.getService(RegressionService);

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
   * Read values from the regression service if they're available, and format
   * them for a table.
  */
  private getTableRows(modelName: string, fieldName: string, ds: IndexedInput[]) {
    const BLANK = '-';
    const readScore = (id: string): number | null => {
       return this.regressionService.regressionInfo[id]?.[modelName]?.[fieldName]?.prediction;
    };

    return ds.map(d => {
      const parent = this.appState.getCurrentInputDataById(d.meta.parentId);
      if (parent == null) return [];
      const scoreBefore = readScore(parent.id);
      const scoreAfter = readScore(d.id);
      const delta = (scoreBefore != null && scoreAfter != null)
        ? scoreAfter - scoreBefore
        : null;
      return [
        d.data.sentence,
        scoreBefore ? formatLabelNumber(scoreBefore) : BLANK,
        scoreAfter ? formatLabelNumber(scoreAfter) : BLANK,
        delta ? formatLabelNumber(delta) : BLANK
      ];
    });
  }

  render() {
    if (this.generatedDataPoints.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }

    // Fan out by each (model, regression field)
    const modelKeyPairs = this.appState.currentModels.flatMap((modelName: string) => {
      const modelSpec = this.appState.getModelSpec(modelName);
      const regressionKeys = findSpecKeys(modelSpec.output, ['RegressionScore']);
      return regressionKeys.map((fieldName) => ({modelName, fieldName}));
    });

    return modelKeyPairs.map(({modelName, fieldName}) => {
      return html`
        <div>
          ${this.generations.map(({generationKey, ds}, index) => {
            return this.renderGeneration(modelName, fieldName, generationKey, ds, index);
          })}
        </div>
      `;
     });
  }

  renderGeneration(modelName: string, fieldName: string, key: string,
    ds: IndexedInput[], generationIndex: number) {
    return html`
      <div>
        <div class="info">
          <b class="source">${ds[0].meta.source}</b>
          generated ${ds.length === 1 ? '1 datapoint' : `${ds.length} datapoints`}
          ${this.renderNavigationStrip(generationIndex)}
         </div>
        ${this.renderDiffTable(modelName, fieldName, ds)}
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

  renderDiffTable(modelName: string, fieldName: string, ds: IndexedInput[]) {
    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('generated sentence', true);
    columnVisibility.set(`parent ${fieldName}`, true);
    columnVisibility.set(`generated ${fieldName}`, true);
    columnVisibility.set('delta', true);
    
    const table = {
      'data': this.getTableRows(modelName, fieldName, ds)
    };
    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName="delta"
          .defaultSortAscending=${false}
          .columnVisibility=${columnVisibility}
          .data=${table.data}
            selectionDisabled
        ></lit-data-table>
      </div>
    `;
  }

  static shouldDisplayModule(modelSpecs: ModelsMap, datasetSpec: Spec) {
    return doesOutputSpecContain(modelSpecs, this.supportedPredTypes);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'generated-diff': GeneratedDiffModule;
  }
}
