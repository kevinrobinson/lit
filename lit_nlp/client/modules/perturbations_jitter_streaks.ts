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
import {customElement, html, svg} from 'lit-element';
import {computed, observable} from 'mobx';
import {styleMap} from 'lit-html/directives/style-map';
// tslint:disable-next-line:ban-module-namespace-object-escape
const seedrandom = require('seedrandom');  // from //third_party/javascript/typings/seedrandom:bundle

import {app} from '../core/lit_app';
import {LitModule} from '../core/lit_module';
import {TableData} from '../elements/table';
import {JitterChart} from '../elements/jitter';
import {CallConfig, FacetMap, GroupedExamples, IndexedInput, LitName, ModelsMap, Spec} from '../lib/types';
import {doesOutputSpecContain, formatLabelNumber, findSpecKeys} from '../lib/utils';
import {GroupService} from '../services/group_service';
import {ColorService, RegressionService, ClassificationService, SliceService} from '../services/services';
import {RegressionInfo} from '../services/regression_service';

import {styles} from './perturbations_jitter_streaks.css';
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
  delta?: number,
  d: IndexedInput,
  parent: IndexedInput
};

/**
 * Module to visualize how predictions for regression or multiclass classification models
 * change for generated points.
 */
@customElement('perturbations-jitter-streaks')
export class PerturbationsJitterStreaks extends LitModule {
  static title = 'Perturbation Deltas';
  static numCols = 4;
  static template = () => {
    return html`<perturbations-jitter-streaks ></perturbations-jitter-streaks>`;
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

  private readonly colorService = app.getService(ColorService);
  private readonly regressionService = app.getService(RegressionService);
  private readonly classificationService = app.getService(ClassificationService);

  /* This is the flag controlling whether the vis has been created imperatively, and
   * whether the render pass can add in data.in
   */
  @observable private isVisReadyForRender = {[key: string]: boolean};

  constructor() {
    super();
    this.maxPlotWidth = 900;
    this.minPlotHeight = 100;
    this.maxPlotHeight = 250;  // too sparse if taller than this
    this.plotBottomMargin = 35;
    this.plotLeftMargin = 5;
    this.xLabelOffsetY = 30;
    this.yLabelOffsetX = -32;
    this.yLabelOffsetY = -25;
  }

  /* TODO(lit-dev) factor out */
  @computed
  private get generatedDataPoints() {
    return this.appState.currentInputData.filter((d: IndexedInput) => d.meta.added);
  }

  /* TODO(lit-dev) factor out */
  private readFromService(ds: IndexedInput[], readScore: (id: string) => number | undefined): DeltaRow[] {
    return ds.flatMap(d => {
      const parent = this.appState.getCurrentInputDataById(d.meta.parentId);
      if (parent == null) return [];
      
      const before = readScore(parent.id);
      const after = readScore(d.id);
      const delta = (before != null && after != null)
        ? after - before
        : undefined;
      const deltaRow: DeltaRow = {before, after, delta, d, parent};
      return [deltaRow];
    });
  }

  /* TODO(lit-dev) factor out */
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

  /* TODO(lit-dev) factor out */
  mapAcrossSources(fn:(source: Source, deltas: DeltaRow[]) => any) {
    // Fan out by each (model, outputKey, fieldName)
    const sources = this.appState.currentModels.flatMap((modelName: string): Source[] => {
      const modelSpec = this.appState.getModelSpec(modelName);
      const outputSpecKeys: LitName[] = ['RegressionScore', 'MulticlassPreds'];
      return outputSpecKeys.flatMap(specKey => {
        const fieldNames = findSpecKeys(modelSpec.output, [specKey]);
        return fieldNames.map(fieldName => ({modelName, specKey, fieldName}));
       });
    });

    const ds = this.generatedDataPoints;
    return sources.flatMap(source => {
      const scoreReaders = this.getScoreReaders(source);
      return scoreReaders.map(scoreReader => {
        const deltas = this.readFromService(ds, scoreReader);
        return fn(source, deltas);
      });
    });
  }

  // onSelect(selectedRowIndices: number[]) {
  //   const ids = selectedRowIndices
  //                   .map(index => this.appState.currentInputData[index]?.id)
  //                   .filter(id => id != null);
  //   this.selectionService.selectIds(ids);
  // }

  // onPrimarySelect(index: number) {
  //   const id = (index === -1)
  //     ? null
  //     : this.appState.currentInputData[index]?.id ?? null;
  //   this.selectionService.setPrimarySelection(id);
  // }

  updated() {
    this.mapAcrossSources((source, deltas) => this.updateVis(source, deltas));
  }

  render() {
    if (this.generatedDataPoints.length === 0) {
      return html`<div class="info">No counterfactuals created yet.</div>`;
    }
    return this.mapAcrossSources((source, deltas) => this.renderVis(source, deltas));
  }

  renderVis(source: Source, deltas: DeltaRow[]) {
    return html`
      <div class="vis"  data-key=${JSON.stringify(source)}>
        ${this.renderChart(source, deltas)}
      </div>
    `;
  }

  renderChart(source, deltas) {
    return svg`
      <svg class='svg' xmlns='http://www.w3.org/2000/svg'>
        <g class="axes" />
        ${this.renderVisSubstance(source, deltas)}
      </svg>
    `;
  }

  renderVisSubstance(source, deltaRows) {
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

    return svg`
      <g>${filtered.map(dr => {
        const x = this.xScale(dr.after);
        const y = this.yScale(this.randos[dr.d.id]);
        const translation = `translate(${x}, ${y})`;
        const color = this.colorService.getDatapointColor(dr.d);
        const radius = 4;
        const titleText = [
          dr.before.toFixed(3),
          dr.delta > 0 ? 'up to' : 'down to',
          dr.after.toFixed(3)
        ].join(' ');
        return svg`
          <g class="point" transform=${translation}>
            <rect
              class="smear"
              x=${radius + (dr.delta > 0 ? this.xScale(dr.delta) : 0)}
              y="-1"
              width=${Math.abs(this.xScale(dr.delta)) - radius}
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
    const el = div.querySelector('svg');

    // size
    this.plotWidth = div.clientWidth - this.plotLeftMargin * 2;
    this.plotHeight = Math.min(div.clientHeight, this.maxPlotHeight) - this.plotLeftMargin * 2;
    const selected = d3.select(el)
      .attr('width', this.plotWidth)
      .attr('height', this.plotHeight);

    // initialize jitter for yScale so it's consistent
    const rngSeed = 'lit';
    // tslint:disable-next-line:no-any ban-module-namespace-object-escape
    const rng = seedrandom(rngSeed);
    this.randos = {};
    deltas.forEach(delta => this.randos[delta.d.id] = rng())

    // define scales
    this.xScale = d3.scaleLinear()
      .domain([0, 1])
      .range([0, this.plotWidth - this.plotLeftMargin]);
    this.yScale = d3.scaleLinear()
      .domain([0, 1])
      .range([this.plotHeight - this.plotBottomMargin, 0]);

    // do this imperatively so we can use d3 to make nice axes
    this.makeAxes(el.querySelector('.axes'));

    // tell UI we're ready for a proper LitElement render
    this.isVisReadyForRender[key] = true;
  }

  makeAxes(el: SVGElement) {
    d3.select(el).append('g')
      .attr('id', 'xAxis')
      .attr('transform', `translate(
        ${this.plotLeftMargin}, 
        ${this.plotHeight - this.plotBottomMargin}
      )`)
      .call(d3.axisBottom(this.xScale));

    // TODO(lit-dev) update ticks based on type of data available; see predictions module
    const axisGenerator = d3.axisLeft(this.yScale);
    axisGenerator.ticks(0);
    d3.select(el).append('g')
      .attr('id', 'yAxis')
      .attr('transform', `translate(${this.plotLeftMargin}, 0}`)
      .call(axisGenerator);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'perturbations-jitter-streaks': PerturbationsJitterStreaks;
  }
}
