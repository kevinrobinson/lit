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

/**
 * Module to sort generated countefactuals by the change in prediction for a
 regression or multiclass classification model.
 */
@customElement('perturbations-chart-module')
export class PerturbationsChartModule extends LitModule {
  static title = 'Perturbations impact on predictions';
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

  private readonly deltasService = app.getService(DeltasService);
  private readonly colorService = app.getService(ColorService);

  // TODO(lit-dev) factor out selection to deltaService[this.model]
  @observable private filterSelected = true;
  @observable private lastSelectedSourceIndex?: number;

  /* Tunings for vis margins, etc. */
  private readonly maxPlotWidth = 900;
  private readonly minPlotHeight = 100;
  private readonly maxPlotHeight = 250;  // too sparse if taller than this
  private readonly plotBottomMargin = 35;
  private readonly plotLeftMargin = 5;
  private readonly xLabelOffsetY = 30;
  private readonly yLabelOffsetX = -32;
  private readonly yLabelOffsetY = -25;
  private plotHeight?: number = undefined;
  private plotWidth?: number = undefined;

  private xScale?: d3.AxisScale<number> = undefined;
  private yScale?: d3.AxisScale<number> = undefined;
  private jitterForId:{[id: string]: number} = {};

  /* This controls whether each vis has been created imperatively, and
   * whether the render pass should render data or not.
   */
  @observable private isVisReadyForRender: {[sourceKey: string]: boolean} = {};



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

  updated() {
    return this.deltasService.sourcesForModel(this.model).map(source => {
      const deltaRows = this.filteredDeltasRowsForSource(source);
      this.updateVis(source, deltaRows);
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
      return this.renderVis(source, index, deltaRows);
    });
  }

  // TODO(lit-dev) navigation UI
  private renderVis(source: Source, sourceIndex: number, deltaRows: DeltaRow[]) {
    const rootClass = classMap({
      'vis': true,
      'hidden': (sourceIndex !== (this.lastSelectedSourceIndex ?? 0)),
      [sourceIndex]: true
    });
    return html`
      <div class=${rootClass} data-key=${JSON.stringify(source)}>
        ${this.renderChart(source, deltaRows)}
      </div>
    `;
  }

  private renderChart(source: Source, deltas: DeltaRow[]) {
    return svg`
      <svg class='svg' xmlns='http://www.w3.org/2000/svg'>
        <g class="axes" />
        ${this.renderVisSubstance(source, deltas)}
      </svg>
    `;
  }


  private renderVisSubstance(source: Source, deltaRows: DeltaRow[]) {
    // Some of the vis is built imperatively, so wait until that's done.
    const key = JSON.stringify(source);
    const isReady = (
      (this.isVisReadyForRender[key]) &&
      (this.xScale != null) &&
      (this.yScale != null) &&
      (this.jitterForId != null)
    );
    if (!isReady) {
      return null;
    }

    // These can be null when fetching; wait until everything is ready.
    const filtered = deltaRows.filter(dr => {
      if (dr.before == null) return false;
      if (dr.after == null) return false;
      if (dr.delta == null) return false;
      return true;
    });

    const xScale = this.xScale! as d3.AxisScale<number>;
    const yScale = this.yScale! as d3.AxisScale<number>;
    return svg`
      <g>${filtered.map(deltaRow => {
        const dr = (deltaRow as CompleteDeltaRow);
        const x = xScale(dr.after);
        const jitter = (parseInt(hash(dr.d.id), 16) % 1000) / 1000;
        const y = yScale(jitter);
        const translation = `translate(${x}, ${y})`;
        const color = this.colorService.getDatapointColor(dr.d);
        const radius = 4;
        const titleText = [
          dr.before.toFixed(3),
          dr.delta > 0 ? 'up to' : 'down to',
          dr.after.toFixed(3)
        ].join(' ');
        const deltaPixels = xScale(dr.delta)!;
        return svg`
          <g class="point" transform=${translation}>
            <rect
              class="smear"
              x=${radius + (dr.delta > 0 ? deltaPixels : 0)}
              y="-1"
              width=${Math.abs(deltaPixels) - radius}
              height="2"
              fill=${color}
              opacity=${0.25}
            />
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
  updateVis(source: Source, deltas: DeltaRow[]) {
    const key = JSON.stringify(source);
    if (this.isVisReadyForRender[key]) {
      return;
    }

    const divs = this.shadowRoot!.querySelectorAll('.vis');
    const div = Array.from(divs).find(el => (el as HTMLElement).dataset['key'] === key);
    if (!div) {
      return;
    }
    const el = div.querySelector('svg') as SVGElement;

    // size
    this.plotWidth = div.clientWidth - this.plotLeftMargin * 2;
    this.plotHeight = Math.min(div.clientHeight, this.maxPlotHeight) - this.plotLeftMargin * 2;
    const selected = d3.select(el)
      .attr('width', this.plotWidth)
      .attr('height', this.plotHeight);

    // define scales
    this.xScale = d3.scaleLinear()
      .domain([0, 1])
      .range([0, this.plotWidth - this.plotLeftMargin]);
    this.yScale = d3.scaleLinear()
      .domain([0, 1])
      .range([this.plotHeight - this.plotBottomMargin, 0]);

    // do this imperatively so we can use d3 to make nice axes
    this.makeAxes(el.querySelector('.axes') as SVGElement);

    // tell UI we're ready for a proper LitElement render
    this.isVisReadyForRender[key] = true;
  }

  makeAxes(el: SVGElement) {
    d3.select(el).append('g')
      .attr('id', 'xAxis')
      .attr('transform', `translate(
        ${this.plotLeftMargin}, 
        ${this.plotHeight! - this.plotBottomMargin}
      )`)
      .call(d3.axisBottom(this.xScale!));

    // TODO(lit-dev) update ticks based on type of data available; see predictions module
    const axisGenerator = d3.axisLeft(this.yScale!);
    axisGenerator.ticks(0);
    d3.select(el).append('g')
      .attr('id', 'yAxis')
      .attr('transform', `translate(${this.plotLeftMargin}, 0)`)
      .call(axisGenerator);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-chart-module': PerturbationsChartModule;
  }
}
