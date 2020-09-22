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
 * Module to show metrics of a model.
 */
@customElement('generated-diff')
export class GeneratedDiffModule extends LitModule {
  static title = 'Counterfactual Changes';
  static numCols = 8;
  static template = (model = '') => {
    return html`<generated-diff model=${model}></generated-diff>`;
  };


  // TODO?
  static supportedPredTypes: LitName[] =
      ['RegressionScore', 'MulticlassPreds', 'GeneratedText', 'SpanLabels'];

  static duplicateForModelComparison = false;

  static get styles() {
    return [sharedStyles, styles];
  }

  private readonly regressionService = app.getService(RegressionService);
  private readonly sliceService = app.getService(SliceService);
  private readonly groupService = app.getService(GroupService);
  private readonly classificationService =
      app.getService(ClassificationService);

  private datasetMetrics: GroupedMetrics[]|null = null;
  private regressionInfo: RegressionInfo[]|null = null;
  @observable private metricsList: GroupedMetricsForDataset[] = [];
  @observable private facetBySlice: boolean = false;
  @observable private selectedFacets: string[] = [];

  @computed
  get tableData() {
    const models = this.appState.currentModels;

    // We get a list (by model) of maps, keyed by metric component.
    // Convert this to the tabular data we need.
    let rows = [] as MetricsRow[];
    this.metricsList.forEach((metricsInfo: GroupedMetricsForDataset) => {
      const newRows = this.createRowsForMetrics(
          metricsInfo.metrics, models, metricsInfo.name, metricsInfo.length,
          metricsInfo.facets);
      if (newRows == null) return;
      rows = rows.concat(newRows);
    });

    // Find all metric names
    const allMetricNames = new Set<string>();
    rows.forEach((row: MetricsRow) => {
      Object.keys(row.metrics).forEach((k: string) => {
        allMetricNames.add(k);
      });
    });

    // Convert back to an array.
    const metricNames = [...allMetricNames];
    const nonMetricNames = ['Model', 'From', 'Field', 'Group', 'N'];
    const facetNames = this.selectedFacets;

    // Add the metrics and feature columns into the rows.
    const rowsData = rows.map((d) => {
      // Add the metrics columns.
      const rowMetrics = metricNames.map((key: string) => {
        const num = d.metrics[key] ?? '-';
        // If the metric is not a whole number, then round to 3 decimal places.
        if (typeof num === 'number' && num % 1 !== 0) {
          return num.toFixed(3);
        }
        return num;
      });

      // Add the "Facet by" columns.
      const rowFacets = this.selectedFacets.map((facet: string) => {
        if (d.facets && d.facets[facet]) {
          return d.facets[facet];
        }
        return '-';
      });

      return [
        d.model, d.selection, d.predKey, d.group, d.numExamples, ...rowFacets,
        ...rowMetrics
      ];
    });

    const tableData = {
      'header': nonMetricNames.concat(facetNames.concat(metricNames)),
      'data': rowsData
    };
    return tableData;
  }

  firstUpdated() {
    // this.react(() => this.regressionService.regressionInfo, regressionInfo => {
    //   this.onRegressionComputed(regressionInfo);
    // });
    // this.react(() => this.appState.currentInputData, entireDataset => {
    //   this.updateDatasetMetrics(entireDataset);
    // });
    // this.react(() => this.selectionService.selectedInputData, () => {
    //   this.updateMetricsList();
    // });
    // this.react(() => this.classificationService.allMarginSettings, margins => {
    //   this.updateDatasetMetrics(this.appState.currentInputData);
    // });

    // // Do this once, manually, to avoid duplicate calls on load.
    // this.updateDatasetMetrics(this.appState.currentInputData);
  }

  async updateDatasetMetrics(entireDataset: IndexedInput[]) {
    const models = this.appState.currentModels;
    this.datasetMetrics = await Promise.all(models.map(
        async (model: string) => this.getMetrics(entireDataset, model)));
    await this.updateMetricsList();
  }

  async updateMetricsList() {
    const models = this.appState.currentModels;
    const entireDataset = this.appState.currentInputData;
    // If no selected dataset or model, don't calculate metrics.
    if (!models || !entireDataset || this.datasetMetrics == null) {
      return;
    }

    const metricsList: GroupedMetricsForDataset[] = [{
      metrics: this.datasetMetrics,
      length: entireDataset.length,
      name: 'dataset'
    }];
    await this.fillMetricsList(metricsList);

    this.metricsList = metricsList;
  }

  async fillMetricsList(metricsList: GroupedMetricsForDataset[]) {
    const selectedData = this.selectionService.selectedInputData;
    // Add metrics for selected points (if points are selected.)
    if (selectedData.length) {
      const inputData = {'selection': {data: selectedData}};
      await this.fillMetricsListFaceted(metricsList, inputData);
    }

    // Facet the dataset by the category from the dropdown. Note that these
    // dicts are by the category values, not the keys from the dropdown
    // (e.g., "1" and "0" if the category was "label" for a binary task.)
    await this.fillMetricsListFaceted(metricsList, this.getFacetedData());
    await this.fillMetricsListFaceted(metricsList, this.getSlicedData());
  }

  /**
   * Helper to fill the (preexisting) metrics list for data that is faceted
   * (e.g., by slices or features).
   */
  private async fillMetricsListFaceted(
      metricsList: GroupedMetricsForDataset[], facetedData: GroupedExamples) {
    const models = this.appState.currentModels;
    for (const val of Object.keys(facetedData)) {
      const facetedMetrics: GroupedMetrics[] = await Promise.all(models.map(
          async (model: string) =>
              this.getMetrics(facetedData[val].data, model)));

      const displayName: string = facetedData[val].displayName || val;
      metricsList.push({
        metrics: facetedMetrics,
        length: facetedData[val].data.length,
        name: displayName,
        facets: facetedData[val].facets
      });
    }
  }


  private facetedDataDisplayName() {
    const datapointsSelected = this.selectionService.selectedInputData.length;
    return (datapointsSelected ? 'selection' : 'dataset') + ' (faceted)';
  }

  /**
   * Facet the data by whatever features we have selected.
   * If there are multiple slices, these need to be intersectional.
   * So, we iterate over each datapoint, and add it to a bin based on
   * its facet feature values (the bin is based on a hash of these features)
   */
  private getFacetedData(): GroupedExamples {
    const data = this.selectionService.selectedOrAllInputData;

    // Get the intersectional feature bins.
    if (this.selectedFacets.length > 0) {
      const groupedExamples =
          this.groupService.groupExamplesByFeatures(data, this.selectedFacets);

      // Manually set all of their display names.
      Object.keys(groupedExamples).forEach(key => {
        groupedExamples[key].displayName = this.facetedDataDisplayName();
      });
      return groupedExamples;
    }
    return {};
  }

  /**
   * Facet the data by slices.
   */
  private getSlicedData(): GroupedExamples {
    const facetedData: GroupedExamples = {};
    if (this.facetBySlice) {
      this.sliceService.sliceNames.forEach(name => {
        // For each slice, get the data and metrics.
        facetedData[name] = {
          displayName: 'Slice : ' + name,
          data: this.sliceService.getSliceDataByName(name)
        };
      });
    }
    return facetedData;
  }

  private async getMetrics(selectedInputs: IndexedInput[], model: string) {
    if (selectedInputs == null || selectedInputs.length === 0) return;
    const config =
        this.classificationService.marginSettings[model] as CallConfig || {};
    const metrics = await this.apiService.getInterpretations(
        selectedInputs, model, this.appState.currentDataset, 'metrics', config);
    return metrics;
  }

  private createRowsForMetrics(
      modelMetrics: GroupedMetrics[], models: string[], selectionName: string,
      length: number, facets?: FacetMap) {
    const rows: MetricsRow[] = [];
    for (let i = 0; i < models.length; i++) {
      const metrics = modelMetrics[i] as {[group: string]: MetricsResponse[]};
      if (metrics == null) continue;
      for (const group of Object.keys(metrics)) {
        for (const entry of metrics[group]) {
          // Skip rows with no metrics.
          if (Object.keys(entry['metrics']).length === 0) {
            continue;
          }
          rows.push({
            model: models[i],
            selection: selectionName,
            group,
            numExamples: length,
            labelKey: entry['label_key'],
            predKey: entry['pred_key'],
            metrics: entry['metrics'],
            facets
          });
        }
      }
    }
    return rows;
  }

  private async onRegressionComputed() {
    // // ??? not sure on architecture here
    // const models = this.appState.currentModels;
    // const model = models[0];
    // const spec = this.appState.getModelSpec(model);
    // const regressionKeys = findSpecKeys(spec.output, ['RegressionScore']);
    // const scoreField = regressionKeys[0];
    // // const textFields: string[] = findSpecKeys(spec.input, 'TextSegment');
    // // const scoreFields: string[] = findSpecKeys(spec.output, 'RegressionScore');
    // // if (scoreFields.length !== 1) {
    // //   return;
    // // }

    // // Add the error info for any regression keys.
    // const ds = this.generatedDataPoints || [];
    // const ids = ds.map(d => d.id);
    // // const regressionKeys = Object.keys(regressionPreds[0]);
    //   // for (let j = 0; j < regressionKeys.length; j++) {
    // this.regressionInfo = await this.regressionService.getResults(
    //         ids, model, scoreField);
  }

  @computed
  get generatedDataPoints() {
    return this.appState.currentInputData.filter((d: IndexedInput) => d.meta.added);
  }

  @computed
  get generations() {
    const groupedByGeneration: {[key: string]: IndexedInput[]} = {};
    this.generatedDataPoints.forEach((d: IndexedInput) => {
      const {source, creationId, parentId} = d.meta;
      const key = [source || '(unknown)', creationId || ('unknown')].join('-');
      groupedByGeneration[key] = (groupedByGeneration[key] || []).concat([d]);
    });

    return Object.keys(groupedByGeneration).map(key => {
      return {
        key: key,
        ds: groupedByGeneration[key]
      };
    });
  }

  render() {
    if (this.generatedDataPoints.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }

    return html`
      <div>
        ${this.generations.map(({key, ds}, index) => this.renderGeneration(key, ds, index))}
      </div>
    `;
  }

  renderGeneration(key: string, ds: IndexedInput[], generationIndex: number) {
    return html`
      <div>
        <div class="info">
          <b class="source">${ds[0].meta.source}</b>
          generated ${ds.length === 1 ? '1 datapoint' : `${ds.length} datapoints`}.
          ${this.renderNavigationStrip(generationIndex)}
         </div>
        ${this.renderDiffTable(ds)}
      </div>
    `;
  }

  renderNavigationStrip(generationIndex) {

    const onChangeOffset = (delta) => {
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
    return html`
      <span class="navigation-buttons">
        ${generationIndex - 1 >= 0 ? previousButton : null}
        ${generationIndex + 1 <= this.generations.length ? nextButton : null}
      </span>
    `;
  }

  renderDiffTable(ds: IndexedInput[]) {
    // ??? not sure on architecture here
    const models = this.appState.currentModels;
    const model = models[0];
    const spec = this.appState.getModelSpec(model);
    const regressionKeys = findSpecKeys(spec.output, ['RegressionScore']);
    const scoreField = regressionKeys[0];

    // actual UI
    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('generated sentence', true);
    columnVisibility.set(`parent ${scoreField}`, true);
    columnVisibility.set(`generated ${scoreField}`, true);
    columnVisibility.set('delta', true);
    
    const BLANK = '-';
    const readScore = (id: string): number | null => {
       return this.regressionService.regressionInfo[id]?.[model]?.[scoreField]?.prediction;
    };
    const table = {
      'header': ['generated', `${scoreField}-before`, `${scoreField}-after`, 'delta'],
      'data': ds.map(d => {
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
      })
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

  // ${ds.map(d => this.renderGeneratedDiff(d))}
  renderGeneratedDiff(d: IndexedInput) {
    const parent = this.appState.getCurrentInputDataById(d.meta.parentId);
    if (!parent) return;
    return html`
      <div>
        ${parent.data.sentence}
        ${d.data.sentence}
        <br/>
        <br/>
      </div>
     `;
  }

  renderTable() {
    const columnNames = this.tableData.header;
    const columnVisibility = new Map<string, boolean>();
    columnNames.forEach((name) => {
      columnVisibility.set(name, true);
    });

    return html`
    <lit-data-table
      .columnVisibility=${columnVisibility}
      .data=${this.tableData.data}
        selectionDisabled
    ></lit-data-table>
  `;
  }

  renderFacetSelector() {
    // Update the filterdict to match the checkboxes.
    const onFeatureCheckboxChange = (e: Event, key: string) => {
      if ((e.target as HTMLInputElement).checked) {
        this.selectedFacets.push(key);
      } else {
        const index = this.selectedFacets.indexOf(key);
        this.selectedFacets.splice(index, 1);
      }
      this.updateMetricsList();
    };

    // Disable the "slices" on the dropdown if all the slices are empty.
    const slicesDisabled = this.sliceService.areAllSlicesEmpty();

    const onSlicesCheckboxChecked = (e: Event) => {
      this.facetBySlice = (e.target as HTMLInputElement).checked;
      this.updateMetricsList();
    };
    // clang-format off
    return html`
    <div class="facet-selector">
      <label class="dropdown-label">Show slices</label>
      ${this.renderCheckbox('', false, (e: Event) => {onSlicesCheckboxChecked(e);},
            slicesDisabled)}
      <label class="dropdown-label">Facet by</label>
       ${
        this.groupService.categoricalAndNumericalFeatureNames.map(
            facetName => this.renderCheckbox(facetName, false,
                (e: Event) => {onFeatureCheckboxChange(e, facetName);}, false))}
    </div>
    `;
    // clang-format on
  }

  private renderCheckbox(
      key: string, checked: boolean, onChange: (e: Event, key: string) => void,
      disabled: boolean) {
    // clang-format off
    return html`
        <div class='checkbox-holder'>
          <lit-checkbox
            ?checked=${checked}
            ?disabled=${disabled}
            @change='${(e: Event) => {onChange(e, key);}}'
            label=${key}>
          </lit-checkbox>
        </div>
    `;
    // clang-format on
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
