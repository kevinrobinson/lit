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
import hash from 'object-hash';
import {customElement, html, svg} from 'lit-element';
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
import {DeltasService, ColorService} from '../services/services';
import {RegressionInfo} from '../services/regression_service';
import {DeltaRow, DeltaInfo, Source} from '../services/deltas_service';

import {styles} from './perturbations_chart_module.css';
import {styles as sharedStyles} from './shared_styles.css';


// TODO(lit-dev)
import './pc';

// type DeltaRowsById = {
//   [id: string]: DeltaRow
// };

interface CompleteDeltaRow {
  before: number,
  after: number,
  delta: number,
  d: IndexedInput,
  parent: IndexedInput
};

interface Dims {
  width: number;
  height: number;
}

interface Brushed {
  xRange: [number, number];
  yRange: [number, number];
}

interface ChartSizing {
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }
  plotWidth: number;
  plotHeight: number;
  xScale: d3.AxisScale<number>;
  yScale: d3.AxisScale<number>;
}

interface VisualizationConfig {
  key: string;
  text: string;
  yDomain: [number, number];
  yTicks: number;
  yValueToProject: (dr: CompleteDeltaRow) => number;
  includeStreaks: boolean;
}

const STREAKS_VISUALIZATION_OPTION: VisualizationConfig = {
  key: 'streaks',
  text: 'streaks',
  yDomain: [0, 1],
  yTicks: 0,
  includeStreaks: true,
  yValueToProject: dr => (parseInt(hash(dr.d.id), 16) % 1000) / 1000
};

const SCATTERPLOT_VISUALIZATION_OPTION: VisualizationConfig = {
  key: 'scatterplot',
  text: 'scatterplot',
  yDomain: [-1, 1],
  yTicks: 3,
  includeStreaks: true,
  yValueToProject: dr => dr.delta
}

interface GroupingConfig {
  key: string;
  text: string;
}

const NO_GROUPING_OPTION: GroupingConfig = {
  key: 'none',
  text: 'none'
};

const PERTURBATION_GROUPING_OPTION: GroupingConfig = {
  key: 'perturbation',
  text: 'perturbation'
};

type GroupingFunction = (dr: DeltaRow) => string;

/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression or multiclass classification model.
 */
@customElement('perturbations-chart-module')
export class PerturbationsChartModule extends LitModule {
  static title = 'Impact on predictions';
  static numCols = 4;
  static duplicateForModelComparison = true;
  static duplicateAsRow = false;
  static template = (model = '') => {
    return html`<perturbations-chart-module model=${model}></perturbations-chart-module>`;
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

  /* UI description */
  private readonly GROUPING_OPTIONS: GroupingConfig[] = [
    NO_GROUPING_OPTION,
    PERTURBATION_GROUPING_OPTION
  ];
  private readonly VISUALIZATION_OPTIONS: VisualizationConfig[] = [
    // STREAKS_VISUALIZATION_OPTION,
    SCATTERPLOT_VISUALIZATION_OPTION
  ]

  private readonly deltasService = app.getService(DeltasService);
  private readonly colorService = app.getService(ColorService);

  // TODO(lit-dev) factor out selection to deltaService[this.model]
  @observable private lastSelectedSourceIndex?: number;
  @observable private selectedGroupingKey = this.GROUPING_OPTIONS[0].key;
  @observable private selectedVisualizationKey = this.VISUALIZATION_OPTIONS[0].key;
  @observable private brushed?: Brushed;
  /* Tunings for vis margins, etc. */
  // private readonly 
  // private readonly maxPlotWidth = 900;
  // private readonly minPlotHeight = 100;
  // private readonly maxPlotHeight = 250;  // too sparse if taller than this
  // private readonly plotBottomMargin = 35;
  // private readonly plotLeftMargin = 35;
  // private readonly xLabelOffsetY = 30;
  // private readonly yLabelOffsetX = -32;
  // private readonly yLabelOffsetY = -25;
  // @observable private plotHeight?: number = undefined;
  // @observable private plotWidth?: number = undefined;
  // @observable private clientWidth?: number = undefined;
  // @observable private manuallyReadClientWidth?: number = undefined;
  // @observable private manuallyReadClientHeight?: number = undefined;
  @observable private dims?: Dims = undefined;
  private resizeObserver!: ResizeObserver;

  // private xScale?: d3.AxisScale<number> = undefined;
  // private yScale?: d3.AxisScale<number> = undefined;


  /* This controls whether each vis has been created imperatively, and
   * whether the render pass should render data or not.
   */
  // @observable private isVisReadyForRender: {[sourceKey: string]: boolean} = {};

  // statically configurable
  private sizing(dims: Dims): ChartSizing {
    // config
    const maxPlotHeight = 350;  // avoid the chart being too sparse vertically
    const margins = {
      top: 10,
      bottom: 30,
      left: 30,
      right: 10
    };

    // size
    const plotWidth = dims.width;
    const plotHeight = Math.min(dims.height, maxPlotHeight);

    // define scales
    const {yDomain} = this.visConfig;
    const xScale = d3.scaleLinear()
      .domain([0, 1])
      .range([margins.left, plotWidth - margins.right])
      .clamp(true);
    const yScale = d3.scaleLinear()
      .domain(yDomain)
      .range([plotHeight - margins.bottom, margins.top])
      .clamp(true);

    return {
      plotWidth,
      plotHeight,
      xScale,
      yScale,
      margins
    };
  }


  // vis config that changes on user actions
  @computed
  private get visConfig(): VisualizationConfig {
    return this.VISUALIZATION_OPTIONS.find(option => {
      return (option.key === this.selectedVisualizationKey);
    })!;
  }

  // private onSelect(selectedRowIndices: number[]) {
  //   const ids = selectedRowIndices
  //                   .map(index => this.appState.currentInputData[index]?.id)
  //                   .filter(id => id != null);
  //   this.selectionService.selectIds(ids);
  // }

  // private onPrimarySelect(index: number) {
  //   const id = (index === -1)
  //     ? null
  //     : this.appState.currentInputData[index]?.id ?? null;
  //   this.selectionService.setPrimarySelection(id);
  // }

  // TODO(lit-dev) factor out?
  /* Enforce selection */
  // private filteredDeltaRows(deltaRows: DeltaRow[]): DeltaRow[] {
  //   return (this.filterSelected)
  //     ? this.deltasService.selectedDeltaRows(deltaRows)
  //     : deltaRows;
  // }

  
  render() {
    console.log('> PARENT render', this.dims);
    return html`<div id="root">${this.renderContent()}`;

  }

  renderContent() {
    const ds = this.appState.generatedDataPoints;
    if (ds.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }
    
    /* Consider classification and regression predictions, and fan out by
     * each (model, outputKey, fieldName).
     */
    return this.deltasService.sourcesForModel(this.model).map((source, index) => {
      const deltaInfo = this.deltasService.deltaInfoFromSource(source);
      return html`
        ${this.renderControls(deltaInfo.generationKeys)}
        <div class="chart-or-charts">
          ${this.renderChartOrStackedCharts(source, index, deltaInfo)}
        </div>
      `;
    });
  }

  private renderControls(generationKeys: string[]) {
    const onFacetingChange = (e: Event) => {
      this.selectedGroupingKey = {
        [PERTURBATION_GROUPING_OPTION.key]: NO_GROUPING_OPTION.key,
        [NO_GROUPING_OPTION.key]: PERTURBATION_GROUPING_OPTION.key
      }[this.selectedGroupingKey];
    };

    const onVisualizationChange = (e: Event) => {
      this.selectedVisualizationKey = (e.target as HTMLSelectElement).value;
    };
    return html`
      <div class="controls-holder">
        <div class="dropdown-holder">
          <lit-checkbox
            label="Facet by perturbation"
            ?disabled=${generationKeys.length < 2}
            ?checked=${this.selectedGroupingKey === PERTURBATION_GROUPING_OPTION.key}
            @change=${onFacetingChange}
          ></lit-checkbox>
        </div>
      </div>
    `;
  }

  private renderChartOrStackedCharts(source: Source, sourceIndex: number, deltaInfo: DeltaInfo) {    
    const {generationKeys, deltaRowsByGeneration, allDeltaRows, rulesByGeneration} = deltaInfo;

    if (this.selectedGroupingKey === PERTURBATION_GROUPING_OPTION.key) {
      return generationKeys.map(key => {
        const rules = rulesByGeneration[key];
        const labelText = Array.from(new Set(rules)).join(' ');
        return this.renderForSource(source, sourceIndex, deltaRowsByGeneration[key], labelText);
      });
    }

    return this.renderForSource(source, sourceIndex, allDeltaRows);
  }

  // TODO(lit-dev) navigation UI
  private renderForSource(source: Source, sourceIndex: number, deltaRows: DeltaRow[], labelText?: string) {
    const classes = classMap({
      'container': true,
      'hidden': (sourceIndex !== (this.lastSelectedSourceIndex ?? 0)),
      [sourceIndex]: true
    });

    // TODO(lit-dev) this doesn't work, because the parent component
    // doesn't read these observables at render time, so it can't track
    // the dependency.  The child component can track this though, so 
    // why doesn't it re-render?
    //
    // The child component doesn't change; it can't see inside the functions,
    // so from its perspective, nothing has changed.  Takeaway: don't pass
    // functions, they're opaque (in React, it's an identity check).
    const isIdPrimary = (id: string) => this.selectionService.primarySelectedId === id;
    const isIdSelected = (id: string) => this.selectionService.isIdSelected(id);
    const getDatapointColor = (d: IndexedInput) => this.colorService.getDatapointColor(d);
    const onIdsSelected = (ids: string[]) => this.selectionService.selectIds(ids);

    // TODO(lit-dev) moving reads of values into functions breaks the observability;
    // doing that means the child component doesn't re-render in response to changes in
    // selection.
    return html`
      <div class=${classes} data-source-index=${sourceIndex}>
        <lit-perturbations-chart
          class="chart"
          .labelText=${labelText}
          .visConfig=${this.visConfig}
          .source=${source}
          .deltaRows=${deltaRows}
          .isIdPrimary=${isIdPrimary}
          .isIdSelected=${isIdSelected}
          .getDatapointColor=${getDatapointColor}
          .onIdsSelected=${onIdsSelected}
        />
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-chart-module': PerturbationsChartModule;
  }
}
