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

interface ChartSizing {
  clientWidth: number;
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
  includeStreaks: false,
  yValueToProject: dr => dr.delta
}
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
  private readonly GROUPING_OPTIONS = [
    { name: 'none' },
    { name: 'perturbation' }
  ];
  private readonly VISUALIZATION_OPTIONS: VisualizationConfig[] = [
    STREAKS_VISUALIZATION_OPTION,
    SCATTERPLOT_VISUALIZATION_OPTION
  ]

  private readonly deltasService = app.getService(DeltasService);
  private readonly colorService = app.getService(ColorService);

  // TODO(lit-dev) factor out selection to deltaService[this.model]
  @observable private filterSelected = true;
  @observable private lastSelectedSourceIndex?: number;
  @observable private selectedGroupingIndex = 0;
  @observable private selectedVisualizationKey = this.VISUALIZATION_OPTIONS[0].key;

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
  @observable private manuallyReadClientWidth?: number = undefined;
  @observable private manuallyReadClientHeight?: number = undefined;

  // private xScale?: d3.AxisScale<number> = undefined;
  // private yScale?: d3.AxisScale<number> = undefined;


  /* This controls whether each vis has been created imperatively, and
   * whether the render pass should render data or not.
   */
  @observable private isVisReadyForRender: {[sourceKey: string]: boolean} = {};

  // statically configurable
  @computed
  private get sizing(): ChartSizing {
    // config
    const maxPlotHeight = 250;  // too sparse if taller than this
    const margins = {
      top: 10,
      bottom: 30,
      left: 30,
      right: 10
    };

    // size
    const clientWidth = this.manuallyReadClientWidth || -1;
    const clientHeight = this.manuallyReadClientHeight || -1;
    const plotWidth = clientWidth - (margins.left + margins.right);
    const plotHeight = Math.min(clientHeight, maxPlotHeight) - (margins.top - margins.bottom);

    // define scales
    const {yDomain} = this.visConfig;
    const xScale = d3.scaleLinear()
      .domain([0, 1])
      .range([margins.left, plotWidth - margins.right]);
    const yScale = d3.scaleLinear()
      .domain(yDomain)
      .range([plotHeight - margins.bottom, margins.top]);
    // console.log('xScale', xScale.domain(), xScale.range());
    return {plotWidth, plotHeight, xScale, yScale, clientWidth, margins};
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
  private filteredDeltaRows(deltaRows: DeltaRow[]): DeltaRow[] {
    return deltaRows.filter(deltaRow => {
      return (this.selectionService.isIdSelected(deltaRow.d.id) ||
        this.selectionService.isIdSelected(deltaRow.parent.id));
    });
  }

  // TODO(lit-dev) factor out this selection state to DeltasService, so 
  // components are synced.  filtering too!  keyed by `modelName`
  private filteredDeltasRowsForSource(source: Source) {
    const {generationKeys, deltaRows} = this.deltasService.deltaInfoFromSource(source);
    const filteredDeltaRows = this.filteredDeltaRows(deltaRows);
    // const deltaRowsById: DeltaRowsById = {};
    // deltaRows.forEach(deltaRow => deltaRowsById[deltaRow.d.id] = deltaRow);
    return filteredDeltaRows;
  }

  
  // TODO(lit-dev) why axis ticks not changing?
  // firstUpdate() {
  //   this.react(() => this.selectedVisualizationKey, () => this.doUpdate());
  // }

  updated() {
    this.doUpdate();
  }

  doUpdate() {
    return this.deltasService.sourcesForModel(this.model).map((source, index) => {
      const deltaRows = this.filteredDeltasRowsForSource(source);
      this.updateVis(source, index, deltaRows);
    });
  }

  render() {
    const ds = this.appState.generatedDataPoints;
    if (ds.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }
    
    /* Consider classification and regression predictions, and fan out by
     * each (model, outputKey, fieldName).
     */
    return this.deltasService.sourcesForModel(this.model).map((source, index) => {
      const deltaRows = this.filteredDeltasRowsForSource(source);
      return this.renderForSource(source, index, deltaRows);
    });
  }

  // TODO(lit-dev) navigation UI
  private renderForSource(source: Source, sourceIndex: number, deltaRows: DeltaRow[]) {
    const rootClass = classMap({
      'vis': true,
      'hidden': (sourceIndex !== (this.lastSelectedSourceIndex ?? 0)),
      [sourceIndex]: true
    });
    return html`
      <div class=${rootClass} data-source-index=${sourceIndex}>
        ${this.renderControls()}
        ${this.renderChart(source, deltaRows)}
      </div>
    `;
  }

  private renderControls() {
    const onGroupingChange = (e: Event) => {
      this.selectedGroupingIndex = +((e.target as HTMLSelectElement).value);
    };
    const onVisualizationChange = (e: Event) => {
      this.selectedVisualizationKey = (e.target as HTMLSelectElement).value;
    };
    return html`
      <div class="controls-holder">
        <span>
        <div class="dropdown-holder">
          <label class="dropdown-label">Show slices</label>
        </div>
        <div class="dropdown-holder">
          <label class="dropdown-label">Facet by</label>
          <select class="dropdown" @change=${onGroupingChange}>
            ${this.GROUPING_OPTIONS.map((option, i) => html`
              <option ?selected=${this.selectedGroupingIndex === i} value=${i}>
                ${option.name}
              </option>`)}
          </select>
        </div>
        </span>
        <span>
          <div class="dropdown-holder">
            <label class="dropdown-label">Visualization</label>
            <select class="dropdown" @change=${onVisualizationChange}>
              ${this.VISUALIZATION_OPTIONS.map(option => html`
                <option ?selected=${this.selectedVisualizationKey === option.key} value=${option.key}>
                  ${option.text}
                </option>`)}
            </select>
          </div>
        </span>
      </div>
    `;
  }


  private renderChart(source: Source, deltas: DeltaRow[]) {
    return svg`
      <svg class='svg' xmlns='http://www.w3.org/2000/svg'>
        ${this.renderSizingRect()}
        <g class="axes" />
        ${this.renderVisSubstance(source, deltas)}
      </svg>
    `;
  }

  renderSizingRect() {
    const {plotWidth, plotHeight, xScale, yScale} = this.sizing;
    return svg`
      <g>
        <rect
          x=${0}
          y=${0}
          width=${plotWidth}
          height=${plotHeight}
          fill="yellow"
          opacity="0.25"
        />
        <rect
          x=${xScale.range()[0]}
          width=${xScale.range()[1] - xScale.range()[0]}
          y=${yScale.range()[1]}
          height=${yScale.range()[0] - yScale.range()[1]}
          fill="green"
          opacity="0.25"
        />
      </g>
    `;
  }


  // //
  // /* config = {
  //   scatterplot: (yValue, yAxis, render, update)
  //   streaks: (yValue, yAxis, render, update)
  // */
  // private yValue(dr: DeltaRow) {
  //   this.yScale = d3.scaleLinear()
  //     .domain(this.getYDomain())
  //     .range([this.plotHeight - this.plotBottomMargin, 0]);
  // }
  // private getYDomain() {
  //   return {
  //     [this.STREAKS_INDEX]: [0, 1]
  //   }
  //   const yScale = this.yScale! as d3.AxisScale<number>;
  //   if (this.selectedVisualizationIndex == this.STREAKS_INDEX) {
  //     const jitter = (parseInt(hash(dr.d.id), 16) % 1000) / 1000;
  //     const zScale = (yScale as d3.AxisScale<number>).domain([0, 2]);
  //     // const yScaleForStreaks = (yScale.copy().domain([0, 1]) as d3.AxisScale<number>);
  //     return yScaleForStreaks(jitter);
  //   }

  //   if (this.selectedVisualizationIndex === this.SCATTERPLOT_INDEX) {
  //     const yScaleForScatterplot = yScale.copy().domain([-1, 1]);
  //     return yScaleForScatterplot(dr.delta);
  //   }
  // }

  private renderVisSubstance(source: Source, deltaRows: DeltaRow[]) {
    // return;
    // console.log('renderVisSubstance', this.sizing);
    // Some of the vis is built imperatively, so wait until that's done.
    const key = JSON.stringify(source);
    if (!this.isVisReadyForRender[key]) {
      return null;
    }

    // These can be null when fetching; wait until everything is ready.
    const filtered = deltaRows.filter(dr => {
      if (dr.before == null) return false;
      if (dr.after == null) return false;
      if (dr.delta == null) return false;
      return true;
    });
    // console.log('filtered.length', filtered.length);

    const {xScale, yScale} = this.sizing;
    const {yValueToProject, includeStreaks} = this.visConfig;
    return svg`
      <g>${filtered.map(deltaRow => {
        const dr = (deltaRow as CompleteDeltaRow);
        const x = xScale(dr.after);
        const y = yScale(yValueToProject(dr));
        const translation = `translate(${x}, ${y})`;
        const color = this.colorService.getDatapointColor(dr.d);
        const radius = 4;
        const titleText = [
          dr.before.toFixed(3),
          dr.delta > 0 ? 'up to' : 'down to',
          dr.after.toFixed(3)
        ].join(' ');
        const deltaPixels = Math.abs(x! - xScale(dr.before)!);
        return svg`
          <g class="point" transform=${translation}>
            ${includeStreaks && svg`<rect
              class="streak"
              x=${(dr.delta > 0) ? -1 * deltaPixels : 0}
              y="-1"
              width=${deltaPixels}
              height="2"
              fill=${color}
              opacity="0.25"
            />`}
            <circle
              class="circle-after"
              r=${radius}
              fill=${color}
              opacity="0.25"
            >
              <title>${titleText}</title>
            </circle>
          </g>
        `;
      })}
      </g>
    `;
  }



  // Build some of the vis iteratively so that we can use some nice d3
  // functions (eg, axes, brushing).
  updateVis(source: Source, sourceIndex: number, deltas: DeltaRow[]) {
    const key = JSON.stringify(source);
    if (this.isVisReadyForRender[key]) {
      return;
    }

    console.log('updateVis', this.sizing);
    const divs = this.shadowRoot!.querySelectorAll('.vis');
    const div = Array.from(divs).find(el => {
      return (el as HTMLElement).dataset['sourceIndex'] === sourceIndex.toString();
    });
    if (!div) {
      return;
    }
    const el = div.querySelector('svg') as SVGElement;
    // this.clientWidth = div.clientWidth;
    this.manuallyReadClientWidth = div.clientWidth;
    this.manuallyReadClientHeight = div.clientHeight;

    // do this imperatively so we can use d3 to make nice axes
    const {plotWidth, plotHeight} = this.sizing;
    const selected = d3.select(el)
      .attr('width', plotWidth)
      .attr('height', plotHeight);

    this.updateAxes(el.querySelector('.axes') as SVGElement);

    // tell UI we're ready for a proper LitElement render
    this.isVisReadyForRender[key] = true;

    // this.updateDataPoints(el, deltas);
  }

  updateAxes(el: SVGElement) {
    const {yTicks} = this.visConfig;
    const {plotHeight, xScale, yScale, margins} = this.sizing;
    d3.select(el).html('');
    d3.select(el).append('g')
      .attr('id', 'xAxis')
      .attr('transform', `translate(
        0, 
        ${plotHeight! - margins.bottom}
      )`)
      .call(d3.axisBottom(xScale));

    // TODO(lit-dev) update ticks based on type of data available; see predictions module
    d3.select(el).append('g')
      .attr('id', 'yAxis')
      .attr('transform', `translate(${margins.left}, 0)`)
      .call(d3.axisLeft(yScale).ticks(yTicks));
  }

  // updateDataPoints(el: SVGElement, deltaRows: DeltaRow[]) {
  //   // These can be null when fetching; wait until everything is ready.
  //   const filtered = deltaRows.filter(dr => {
  //     if (dr.before == null) return false;
  //     if (dr.after == null) return false;
  //     if (dr.delta == null) return false;
  //     return true;
  //   });

  //   const xScale = this.xScale! as d3.AxisScale<number>;
  //   const yScale = this.yScale! as d3.AxisScale<number>;
  //   const {yValueToProject, includeStreaks} = this.getVisConfig();

  //   d3.select(el).selectAll('circle.circle-after')
  //     .data(filtered)
  //     .join('circle')
  //       .classed('circle-after', true)
  //       .attr('r', 4)
  //       .attr('fill', dr => this.colorService.getDatapointColor(dr.d))
  //       .attr('opacity', 0.25);
  //   //           r=${radius}
  //   //           fill=${color}
  //   //           opacity="0.25"
  //   //         >
  //   //   .join("text")
  //   //     const x = xScale(dr.after);
  //   //     const yValue = yValueToProject(dr);
  //   //     const y = yScale(yValue);
  //   //     .attr("x", (d, i) => i * 16)
  //   //     .text(d => d);
  //   // sel.data(filtered).join(
  //   //   enter => )
  //   // sel.append('g').attr('')


  //   //   <g>${filtered.map(deltaRow => {
  //   //     const dr = (deltaRow as CompleteDeltaRow);
  //   //     const x = xScale(dr.after);
  //   //     const yValue = yValueToProject(dr);
  //   //     const y = yScale(yValue);
  //   //     console.log('yValue:', yValue, 'y:', y, 'yScale.domain:', yScale.domain());
  //   //     const translation = `translate(${x}, ${y})`;
  //   //     const color = this.colorService.getDatapointColor(dr.d);
  //   //     const radius = 4;
  //   //     const titleText = [
  //   //       dr.before.toFixed(3),
  //   //       dr.delta > 0 ? 'up to' : 'down to',
  //   //       dr.after.toFixed(3)
  //   //     ].join(' ');
  //   //     const deltaPixels = xScale(dr.delta)!;
  //   //     return svg`
  //   //       <g class="point" transform=${translation}>
  //   //         ${includeStreaks && svg`<rect
  //   //           class="streak"
  //   //           x=${radius + (dr.delta > 0 ? deltaPixels : 0)}
  //   //           y="-1"
  //   //           width=${Math.abs(deltaPixels) - radius}
  //   //           height="2"
  //   //           fill=${color}
  //   //           opacity="0.25"
  //   //         />`}
  //   //         <circle
  //   //           class="circle-after"
  //   //           r=${radius}
  //   //           fill=${color}
  //   //           opacity="0.25"
  //   //         >
  //   //           <title>${titleText}</title>
  //   //         </circle>
  //   //       </g>
  //   //     `;
  //   //   })}
  //   //   </g>
  //   // `;
  // }
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-chart-module': PerturbationsChartModule;
  }
}
