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
    // STREAKS_VISUALIZATION_OPTION,
    SCATTERPLOT_VISUALIZATION_OPTION
  ]

  private readonly deltasService = app.getService(DeltasService);
  private readonly colorService = app.getService(ColorService);

  // TODO(lit-dev) factor out selection to deltaService[this.model]
  @observable private lastSelectedSourceIndex?: number;
  @observable private selectedGroupingIndex = 0;
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

  // TODO(lit-dev) factor out this selection state to DeltasService, so 
  // components are synced.  filtering too!  keyed by `modelName`
  // no filtering...
  private filteredDeltasRowsForSource(source: Source) {
    const {generationKeys, deltaRows} = this.deltasService.deltaInfoFromSource(source);
    return deltaRows;
    // const filteredDeltaRows = this.filteredDeltaRows(deltaRows);
    // const deltaRowsById: DeltaRowsById = {};
    // deltaRows.forEach(deltaRow => deltaRowsById[deltaRow.d.id] = deltaRow);
    // return filteredDeltaRows;
  }

  
  // TODO(lit-dev) why axis ticks not changing?
  // firstUpdate() {
  //   this.react(() => this.selectedVisualizationKey, () => this.doUpdate());
  // }

  setDimensionsIfNecessary() {
    // console.log('setDimensionsIfNecessary');
    const dims = this.readDimensions();
    if (dims && (!this.dims || this.dims.width !== dims.width || this.dims.height !== dims.height)) {
      // console.log('  SET DIMENSIONS');
      this.dims = dims;
    }
  }

  firstUpdated() {
    // TODO(lit-dev) this is doing per-component, but we really want the actual root
    // ie, is this for all sources, or just one source?
    const root = this.shadowRoot!.getElementById('root')!;
    this.resizeObserver = new ResizeObserver(() => {
      // console.log('> resize');
      this.setDimensionsIfNecessary();
    });
    this.resizeObserver.observe(root);
  }

  updated() {
    // console.log('> updated', this.dims);
    this.doUpdate();
  }

  doUpdate() {
    this.setDimensionsIfNecessary();
    return this.deltasService.sourcesForModel(this.model).map((source, index) => {
      const deltaRows = this.filteredDeltasRowsForSource(source);
      this.updateVis(source, index, deltaRows);
    });
  }

  render() {
    // console.log('> render', this.dims);
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
      const deltaRows = this.filteredDeltasRowsForSource(source);
      return this.renderForSource(source, index, deltaRows);
    });
  }

  // TODO(lit-dev) navigation UI
  private renderForSource(source: Source, sourceIndex: number, deltaRows: DeltaRow[]) {
    const classes = classMap({
      'container': true,
      'hidden': (sourceIndex !== (this.lastSelectedSourceIndex ?? 0)),
      [sourceIndex]: true
    });
    return html`
      <div class=${classes} data-source-index=${sourceIndex}>
        ${this.renderControls()}
        <div class="svg-container">
          ${this.renderChart(source, deltaRows)}
        </div>
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
        <div class="dropdown-holder">
          <label class="dropdown-label">Visualization</label>
          <select class="dropdown" @change=${onVisualizationChange}>
            ${this.VISUALIZATION_OPTIONS.map(option => html`
              <option ?selected=${this.selectedVisualizationKey === option.key} value=${option.key}>
                ${option.text}
              </option>`)}
          </select>
        </div>
      </div>
    `;
  }


  private renderChart(source: Source, deltas: DeltaRow[]) {
    if (!this.dims) {
      // console.log('  no dims...');
      return;
    }
    const sizing = this.sizing(this.dims);
    return svg`
      <svg
        class='svg'
        xmlns='http://www.w3.org/2000/svg'
        width=${sizing.plotWidth}
        height=${sizing.plotHeight}
      >
        <g class="axes" />
        <g class="brushing" />
        ${this.renderVisSubstance(source, deltas, sizing)}
      </svg>
    `;
  }

  // renderSizingRect(sizing: ChartSizing) {
  //   const {plotWidth, plotHeight, xScale, yScale} = sizing;
  //   return svg`
  //     <g>
  //       <rect
  //         x=${0}
  //         y=${0}
  //         width=${plotWidth}
  //         height=${plotHeight}
  //         fill="yellow"
  //         opacity="0.25"
  //       />
  //       <rect
  //         x=${xScale.range()[0]}
  //         width=${xScale.range()[1] - xScale.range()[0]}
  //         y=${yScale.range()[1]}
  //         height=${yScale.range()[0] - yScale.range()[1]}
  //         fill="green"
  //         opacity="0.25"
  //       />
  //     </g>
  //   `;
  // }


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

  private renderVisSubstance(source: Source, deltaRows: DeltaRow[], sizing: ChartSizing) {
    // return;
    // console.log('renderVisSubstance', this.dims);
    // Some of the vis is built imperatively, so wait until that's done.
    // const key = JSON.stringify(source);
    // if (!this.isVisReadyForRender[key]) {
    //   return null;
    // }

    // These can be null when fetching; wait until everything is ready.
    const filtered = deltaRows.filter(dr => {
      if (dr.before == null) return false;
      if (dr.after == null) return false;
      if (dr.delta == null) return false;
      return true;
    });
    // console.log('filtered.length', filtered.length);

    const {xScale, yScale} = sizing;
    const {yValueToProject, includeStreaks} = this.visConfig;
    // const ys = filtered.map(dr => yValueToProject(dr as CompleteDeltaRow));
    // const yDomain = [Math.min(...ys), Math.max(...ys)];
    // const yScaleAdjusted = yScale.domain(yDomain).clamp(true);
    return svg`
      <g>${filtered.map(deltaRow => {
        // positioning
        const dr = (deltaRow as CompleteDeltaRow);
        const x = xScale(dr.after);
        const y = yScale(yValueToProject(dr));
        const translation = `translate(${x}, ${y})`;
        const deltaPixels = Math.abs(x! - xScale(dr.before)!);

        // styling
        const color = this.colorService.getDatapointColor(dr.d);
        const radius = 4;
        const titleText = [
          dr.before.toFixed(3),
          dr.delta > 0 ? 'up to' : 'down to',
          dr.after.toFixed(3)
        ].join(' ');
        const isPrimary = (this.selectionService.primarySelectedId === dr.d.id);
        const isSelected = !isPrimary && this.selectionService.isIdSelected(dr.d.id);
        const selectionClasses = {
          'primary': isPrimary,
          'selected': isSelected
        };
        const streakClass = classMap({'streak': true, ...selectionClasses});
        const circleClass = classMap({'circle': true, ...selectionClasses});
        return svg`
          <g class="point" transform=${translation}>
            ${includeStreaks && svg`<rect
              class=${streakClass}
              x=${(dr.delta > 0) ? -1 * deltaPixels : 0}
              y="-1"
              width=${deltaPixels}
              height="2"
              fill=${color}
            />`}
            <circle
              class=${circleClass}
              r=${radius}
              fill=${color}
            >
              <title>${titleText}</title>
            </circle>
          </g>
        `;
      })}
      </g>
    `;
  }


  readDimensions(): Dims | undefined {
    const divs = this.shadowRoot!.querySelectorAll('.container');
    if (divs.length === 0) {
      // console.log('  no divs');
      return undefined;
    }
    const div = divs[0];
    const el = div.querySelector('.svg-container') as SVGElement;
    if (!el) {
      // console.log('  no svg');
      return undefined;
    }
    const width = div.clientWidth;
    const height = el.clientHeight;

    // console.log('  READ DIMENSIONS');
    // const {plotHeight, plotWidth} = this.sizing;
    // if (height > 0 && width > 0 && (plotWidth !== width)) {
    // console.log('setSizing', this.dims);
    // this.dims = {width, height};
    return {width, height};
  }

  // Build some of the vis iteratively so that we can use some nice d3
  // functions (eg, axes, brushing).
  updateVis(source: Source, sourceIndex: number, deltas: DeltaRow[]) {
    if (!this.dims) {
      return;
    }
    const el = this.shadowRoot!.querySelector(`.container[data-source-index='${sourceIndex}'] svg`) as SVGElement;
     if (!el) {
      return;
    }

    // do this imperatively so we can use d3 to make nice axes
    // console.log('updateAxes', this.dims);
    const axesEl = el.querySelector('.axes') as SVGElement;
    const sizing = this.sizing(this.dims);
    this.updateAxes(axesEl, sizing);
    // tell UI we're ready for a proper LitElement render
    // const key = JSON.stringify(source);
    // this.isVisReadyForRender[key] = true;

    const brushingEl = el.querySelector('.brushing') as SVGElement;
    this.updateBrushing(sourceIndex, brushingEl, sizing);
  }

  onBrushed(brush, brushGroup, sourceIndex: number) {
    const selectionEvent = d3.event.selection;
    const brushedIds = this.brushedIds(sourceIndex, selectionEvent);
    this.selectionService.selectIds(brushedIds);

    if (brushedIds.length === 0 && d3.event.sourceEvent.type !== 'end') {
      brush.clear(brushGroup);
    }
    // hide the brushing selection
    // if (brushedIds.length === 0) {
    //   d3.select(el).selectAll('.handle,.selection')
    //     .attr('display', 'none');
    // }
  }

  brushedIds(sourceIndex: number, selectionEvent) {
    if (selectionEvent == null) {
      return [];
    }

    const sources = this.deltasService.sourcesForModel(this.model);
    const source = sources[sourceIndex];
    if (!source) {
      return [];
    }

    // Project each data point and figure out what is in those bounds
    const {xScale, yScale} = this.sizing(this.dims!);
    const boundsX = [selectionEvent[0][0], selectionEvent[1][0]];
    const boundsY = [selectionEvent[0][1], selectionEvent[1][1]];
    const deltaRows = this.filteredDeltasRowsForSource(source);
    const {yValueToProject} = this.visConfig;
    return deltaRows.flatMap(deltaRow => {
      const dr = (deltaRow as CompleteDeltaRow);
      const x = xScale(dr.after)!;
      const y = yScale(yValueToProject(dr))!;
      if (x < boundsX[0] || x > boundsX[1] || y < boundsY[0] || y > boundsY[1]) {
        return [];
      }
      return [dr.d.id];
    });
  }

  updateBrushing(sourceIndex: number, el: SVGElement, sizing: ChartSizing) {
    const brush = d3.brush();
    const {plotWidth, plotHeight} = sizing;
    const brushGroup = d3.select(el).html('').append('g')
      .attr('class', 'brush')
      .call(brush);
    brush.extent([[0, 0], [plotWidth, plotHeight]]);
    brush.on('end', () => {
      this.onBrushed(brush, brushGroup, sourceIndex);
    });

  }

  updateAxes(el: SVGElement, sizing: ChartSizing) {
    const {yTicks} = this.visConfig;
    const {plotHeight, xScale, yScale, margins} = sizing;

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
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-chart-module': PerturbationsChartModule;
  }
}
