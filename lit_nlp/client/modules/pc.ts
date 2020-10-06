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

import * as d3 from 'd3';
import hash from 'object-hash';
import {computed, observable} from 'mobx';
import {css, customElement, html, svg, LitElement, property} from 'lit-element';
import {classMap} from 'lit-html/directives/class-map';
import {styleMap} from 'lit-html/directives/style-map';

import {ReactiveElement} from '../lib/elements';
import {DeltaRow, DeltaInfo, Source} from '../services/deltas_service';
import {CallConfig, FacetMap, GroupedExamples, IndexedInput, LitName, ModelsMap, Spec} from '../lib/types';
import {styles} from './pc.css';


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
  },
  labelsMargins: {
    left: number;
    bottom: number;
  },
  titleMargins: {
    left: number;
    bottom: number;
  };
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




@customElement('lit-perturbations-chart')
export class PerturbationsChart extends ReactiveElement {
  static get styles() {
    return styles;
  }

  @property({type: Object}) visConfig!: VisualizationConfig;
  @property({type: Object}) source!: Source;
  @property({type: Object}) deltaRows!: DeltaRow[];
  @property({type: String}) labelText!: string;

  @property({type: Object}) isIdPrimary?: (id: string) => boolean;
  @property({type: Object}) isIdSelected?: (id: string) => boolean;
  @property({type: Object}) getDatapointColor?: (d: IndexedInput) => string;
  @property({type: Object}) onIdsSelected?: (ids: string[]) => void;
  
  // for sizing
  @observable private dims?: Dims;
  private resizeObserver!: ResizeObserver;
  

  private sizing(dims: Dims): ChartSizing {
    // define margins and constraints
    const maxPlotHeight = 350;  // avoid the chart being too sparse vertically
    const margins = {
      top: 10,
      bottom: 35,
      left: 40,
      right: 10
    };

    // positioning for labels and titles
    const titleMargins = {
      left: 8,
      bottom: 10
    };
    const labelsMargins = {
      bottom: 5,
      left: 11
    };

    // compute sizing from that
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
      margins,
      labelsMargins,
      titleMargins
    };
  }

  firstUpdated() {
    const root = this.shadowRoot!.querySelector('.container')!;
    this.resizeObserver = new ResizeObserver(() => {
      console.log('> resize');
      this.setDimensionsIfNecessary();
    });
    this.resizeObserver.observe(root);
  }

  updated() {
    console.log('> updated', this.dims);
    this.doUpdate();
  }

  private readDimensionsFromDOM(): Dims | undefined {
    const root = this.shadowRoot!.querySelector('.container');
    if (!root) {
      return undefined;
    }
    return {
      width: root.clientWidth,
      height: root.clientHeight
    };
  }


  private setDimensionsIfNecessary() {
    console.log('setDimensionsIfNecessary');
    const dims = this.readDimensionsFromDOM();
    if (dims && (!this.dims || this.dims.width !== dims.width || this.dims.height !== dims.height)) {
      console.log('  SET DIMENSIONS');
      this.dims = dims;
      // TODO(lit-dev) not sure why this is necessary
      this.requestUpdate();
    }
  }

  private doUpdate() {
    this.setDimensionsIfNecessary();
    this.updateVis(this.source, this.deltaRows);
  }

  render() {
    console.log('> child render')
    if (!this.source || !this.deltaRows || !this.visConfig) {
      throw new Error('required properties missing');
    }
    return html`
      <div class="container">
        ${this.renderChart(this.source, this.deltaRows)}
      </div>
    `;
  }

  private renderChart(source: Source, deltas: DeltaRow[]) {
    if (!this.dims) {
      // console.log('  no dims...');
      return;
    }
    const sizing = this.sizing(this.dims);
    console.log('render, sizing:', JSON.parse(JSON.stringify(sizing)));
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
    console.log('  renderVisSubstance');

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
        const color = this.getDatapointColor!(dr.d);
        const radius = 4;
        const titleText = [
          dr.before.toFixed(3),
          dr.delta > 0 ? 'up to' : 'down to',
          dr.after.toFixed(3)
        ].join(' ');
        const isPrimary = this.isIdPrimary!(dr.d.id);
        const isSelected = !isPrimary && this.isIdSelected!(dr.d.id);
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

  // Build some of the vis iteratively so that we can use some nice d3
  // functions (eg, axes, brushing).
  updateVis(source: Source, deltas: DeltaRow[]) {
    if (!this.dims) {
      return;
    }
    const el = this.shadowRoot!.querySelector('svg') as SVGElement;
    if (!el) {
      return;
    }

    const sizing = this.sizing(this.dims);
    this.updateAxesAndLabels(el.querySelector('.axes') as SVGElement, sizing);
    this.updateBrushing(el.querySelector('.brushing') as SVGElement, sizing);
  }

  onBrushed(brush, brushGroup) {
    const selectionEvent = d3.event.selection;
    const brushedIds = this.brushedIds(selectionEvent);
    this.onIdsSelected!(brushedIds);

    if (brushedIds.length === 0 && d3.event.sourceEvent.type !== 'end') {
      brush.clear(brushGroup);
    }
  }

  brushedIds(selectionEvent) {
    if (selectionEvent == null) {
      return [];
    }

    // Project each data point and figure out what is in those bounds
    const {xScale, yScale} = this.sizing(this.dims!);
    const boundsX = [selectionEvent[0][0], selectionEvent[1][0]];
    const boundsY = [selectionEvent[0][1], selectionEvent[1][1]];
    const {yValueToProject} = this.visConfig;
    return this.deltaRows.flatMap(deltaRow => {
      const dr = (deltaRow as CompleteDeltaRow);
      const x = xScale(dr.after)!;
      const y = yScale(yValueToProject(dr))!;
      if (x < boundsX[0] || x > boundsX[1] || y < boundsY[0] || y > boundsY[1]) {
        return [];
      }
      return [dr.d.id];
    });
  }

  updateBrushing(el: SVGElement, sizing: ChartSizing) {
    const {margins, plotWidth, plotHeight} = sizing;

    const brush = d3.brush()
      .extent([[margins.left, margins.top], [plotWidth, plotHeight]])

    const brushGroup = d3.select(el).html('').append('g')
      .attr('class', 'brush')
      .call(brush);

    brush.on('end', () => this.onBrushed(brush, brushGroup));
  }

  updateAxesAndLabels(el: SVGElement, sizing: ChartSizing) {
    const {yTicks} = this.visConfig;
    const {fieldName} = this.source;
    const {
      plotWidth,
      plotHeight,
      xScale,
      yScale,
      margins,
      titleMargins,
      labelsMargins
    } = sizing;

    // x-axis
    d3.select(el).html('');
    d3.select(el).append('g')
      .attr('id', 'xAxis')
      .attr('transform', `translate(
        0, 
        ${plotHeight! - margins.bottom}
      )`)
      .call(d3.axisBottom(xScale));

    // x-axis label
    d3.select(el).append('text')
      .classed('x-axis-label', true)
      .attr('transform', `translate(
        ${margins.left + (plotWidth - margins.left - margins.right)/2},
        ${plotHeight - labelsMargins.bottom}
      )`)
      .style('text-anchor', 'middle')
      .text(fieldName);

    // y-axis
    // TODO(lit-dev) update ticks based on type of data available; see predictions module
    d3.select(el).append('g')
      .attr('id', 'yAxis')
      .attr('transform', `translate(${margins.left}, 0)`)
      .call(d3.axisLeft(yScale).ticks(yTicks));

    // y-axis label
    d3.select(el).append('g')
        .attr('transform', `translate(
          ${labelsMargins.left},
          ${margins.top + (plotHeight - margins.top - margins.bottom)/2}
        )`)
      .append('text')
        .classed('y-axis-label', true)
        .text('delta');

    // title for chart, inset
    const title = {
      text: this.labelText,
      left: margins.left + titleMargins.left,
      top: plotHeight! - margins.bottom - titleMargins.bottom
    };
    d3.select(el).append('text')
      .classed('chart-label', true)
      .attr('transform', `translate(${title.left},  ${title.top})`)
      .text(title.text);
  }
}



declare global {
  interface HTMLElementTagNameMap {
    'lit-perturbations-chart': PerturbationsChart;
  }
}
