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
import * as topojson from "topojson-client";
import {customElement, html, svg, property} from 'lit-element';
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
import {buildGeocoder} from './dialects_geocodes';
import {styles} from './dialects_module.css';
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
type CityToLocation = {
  [city: string]: {
    lat: string,
    lon: string
  }
};

interface PlottableCity {
  name: string,
  dialect: Dialect,
  lat: number,
  lon: number,
}

type Match = {
  d: IndexedInput,
  word: string
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
@customElement('dialects-module')
export class DialectsModule extends LitModule {
  static title = 'Dialects';
  static numCols = 8;
  static template = () => {
    return html`<dialects-module ></dialects-module>`;
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
  @property({type: Object}) cityToLocation: CityToLocation = {};
  @property({type: Object}) us?: any = undefined;

  constructor() {
    super();
    this.wordToDialect = buildMap();
    this.cityToLocation = buildGeocoder();
  }

  onSelect(matches: Match[]) {
    const ids = matches.map(match => match.d.id);
    this.selectionService.selectIds(ids);
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

  firstUpdated() {
    this.fetchMap();
  }

  // updated() {
  // }

  // @action
  async fetchMap() {
    this.us = await d3.json("https://unpkg.com/us-atlas@3/counties-albers-10m.json");
  }

  renderMapSvg() {
    const us = this.us;
    if (this.us == null) {
      return;
    }
    const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
    const path = d3.geoPath();
    const onClear = () => {
      this.onSelect([])
    };
    return svg`
      <svg id='svg' viewBox="0 0 975 610" xmlns='http://www.w3.org/2000/svg' @click=${onClear}>
        <g fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">
          <path stroke="#eee" stroke-width="0.5" d="${path(topojson.mesh(us, us!.objects!.counties, (a, b) => a !== b && (a.id / 1000 | 0) === (b.id / 1000 | 0)))}"></path>
          <path stroke="#999" stroke-width="0.5" d="${path(topojson.mesh(us, us!.objects!.states, (a, b) => a !== b))}"></path>
          <path stroke="#333" d="${path(topojson.feature(us, us.objects.nation))}"></path>
          ${this.renderCities()}
        </g>
      </svg>
    `;
  }

  @computed
  get dialectColor(): d3.ScaleOrdinal<string, string> {
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    this.plottableCities.map(({dialect}) => colorScale(dialect.dialect));
    return colorScale;
  }

  @computed
  get plottableCities(): PlottableCity[] {
    const plottableCities: PlottableCity[] = [];
    this.dialects.forEach(dialect => {
      const regions = (dialect.subregions || '').toLowerCase().split(',');
      regions.forEach(region => {
        const latLon = this.cityToLocation[region];
        if (latLon == null) {
          return;
        }
        const plottableCity: PlottableCity = {
          name: this.prettyPlace(region),
          dialect,
          lat: +latLon.lat,
          lon: +latLon.lon
        };
        plottableCities.push(plottableCity);
      });
    });

    return plottableCities;
  }

  // for both SVG and HTML
  stylesForDialect(dialect: Dialect) {
    const matches = this.matchesByDialect[dialect.dialect] || [];
    const color = this.dialectColor(dialect.dialect);
    const percent = matches.length / this.appState.currentInputData.length;
    return {
      opacity: (0.2 + (0.8 * percent)).toFixed(3),
      background: color,
      fill: color,
      stroke: color
    };
  }

  renderCities() {
    if (this.cityToLocation === {}) {
      return;
    }
    if (this.plottableCities.length === 0) {
      return;
    }
    
    // var coords = []
    // regions.forEach(region => {
    //   const latLon = this.cityToLocation[region];
    //   if (latLon) {
    //     coords.push(latLon);
    //   }
    // });
    const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);

    // return svg`<text>hi</text>`;
    return svg`
      <g class="cities">
        ${this.plottableCities.map(plottableCity => {
          const {lat, lon, dialect, name} = plottableCity;
          const p = projection([lon, lat]);
          if (p == null) {
            // TODO(lit-dev) this is a real data problem
            // console.log('projection', lon, lat, p);
            return null;
          }

          const matches = this.matchesByDialect[dialect.dialect] || [];
          if (matches.length === 0) {
            return null;
          }

          // format circle
          const isSelected = matches.every(match => {
            return this.selectionService.isIdSelected(match.d.id);
          });
          const color = this.dialectColor(dialect.dialect);
          const percent = matches.length / this.appState.currentInputData.length;
          const styles = styleMap(this.stylesForDialect(dialect));
          const textStyles = styleMap({
            opacity: (isSelected ? 1 : 0).toString()
          });
          const transform = `translate(${p.join(",")})`;
          return svg`
            <g transform=${transform}>
              <circle class="city" r="5" style=${styles} />
              <text class="city-text" y="-6" style=${textStyles}>${name}</text>
            </g>
          `;
        })}
      </g>
    `;
  }

  render() {
    // Fan out by each (model, outputKey, fieldName)
    const sources = this.appState.currentModels.flatMap((modelName: string): Source[] => {
      const modelSpec = this.appState.getModelSpec(modelName);
      const outputSpecKeys: LitName[] = ['RegressionScore', 'MulticlassPreds'];
      return outputSpecKeys.flatMap(specKey => {
        const fieldNames = findSpecKeys(modelSpec.output, [specKey]);
        return fieldNames.map(fieldName => ({modelName, specKey, fieldName}));
       });
    });

    const percent = Object.keys(this.matchesByDialect).length / this.dialects.length;
    const styles = styleMap({
      color: 'darkorange',
      opacity: (1 - percent).toFixed(3)
    });
    return html`
      <div id="layout">
        <div id="map">
          ${this.renderMapSvg()}
        </div>
        <div id="data">
          <div class="info">
            <span>
              Possible matches for <b style=${styles}>${Math.round(100 * percent)}%</b> of ${this.dialects.length} dialects
              of <a href="https://dare.wisc.edu/">American Regional English</a>
            </span>
            <span>
              Scanning for ${Object.keys(this.wordToDialect).length} words
              from <a href="https://github.com/afshinrahimi/acl2017">DAREDS</a>
            </span>
           </div>
           <div>

           </div>
           ${this.renderDialectsTable(sources)}
        </div>
      </div>
    `;
  }

  @computed get dialectsByName() {
    const dialectsMap = {};
    Object.values(this.wordToDialect).forEach(entry => dialectsMap[entry.dialect] = entry);
    return dialectsMap;
  }

  @computed get dialects(): Dialect[] {
    return Object.values(this.dialectsByName);
  }

  @computed get matchesByDialect():{[dialect: string]: Match[]} {
    const matchesByDialect:{[dialect: string]: Match[]} = {};
    const matches:{[id: string]: Dialect} = {};
    var ds: IndexedInput[] = [];
    const relevant = this.appState.currentInputData.filter((d: IndexedInput) => {
      const words = d.data.sentence.split(' ');
      words.forEach(word => {
        const dialect = this.wordToDialect[word];
        if (dialect != null) {
          if (matchesByDialect[dialect.dialect] == null) {
            matchesByDialect[dialect.dialect] = [];
          }
          matchesByDialect[dialect.dialect].push({d, word});
          matches[d.id] = dialect;
          ds.push(d);
        }
      });
    });

    return matchesByDialect;
  }

  renderDialectsTable(sources: Source[]) {
    return sources.map(source => {
      const rows = this.dialects.map(dialect => this.rowForDialect(source, dialect));
      return html`
        <div>
          ${this.renderTableForDialect(source, rows)}
        </div>
      `;
    });
  }

  rowForDialect(source: Source, dialect: Dialect) {
    const matches = this.matchesByDialect[dialect.dialect] || [];
    const subregionNames = (dialect.subregions || '').split(',');
    const subregionsText = [
      subregionNames.slice(0, 3).map(this.prettyPlace).join(', '),
      (subregionNames.length > 3) ? ` +${subregionNames.length - 3} more` : ''
    ].join('');

    const row: TableData = [
      this.renderDialectWithSwatch(dialect),
      subregionsText,
      this.renderWords(matches.map(match => match.word)),
      this.renderChart(dialect, matches),
      this.renderSelectButton(matches),
      +matches.length
    ];
    return row;
  }

  renderWords(words: string[]) {
    const uniques = Array.from(new Set(words));
    const wordsText = [
      uniques.slice(0, 3).join(', '),
      (uniques.length > 3) ? ` +${uniques.length - 3} more` : ''
    ].join('');
    const moreWordsText = (uniques.length > 3) ? `+${uniques.slice(3).join(', ')}` : null;

    return html`<span title=${moreWordsText}>${wordsText}</span>`;
  }

  renderSelectButton(matches: Match[]) {
    if (matches.length === 0) {
      return '-';
    }

    const onSelect = () => {
      this.onSelect(matches)
    };

    const isSelected = matches.every(match => {
      return this.selectionService.isIdSelected(match.d.id);
    });
    const styles = styleMap({
      color: (isSelected) ? '#9bb7ba' : 'black'
    });
    const text = `${matches.length} ${matches.length === 1 ? 'datapoint' : 'datapoints'}`
    return html`<button @click=${onSelect} style=${styles}>${text}</button`;
  }

  prettyPlace(place: string) {
    if (place === '') return '';
    return place.split(' ').map(token => token[0].toUpperCase() + token.slice(1)).join(' ');
  }

  renderDialectWithSwatch(dialect: Dialect) {
    const containerStyles = styleMap({
      display: 'flex',
      'flex-direction': 'row'
    });
    const styles = styleMap({
      ...this.stylesForDialect(dialect),
      'width': '16px',
      'height': '16px',
      'margin-right': '5px'
    });
    
    return html`
      <span style=${containerStyles}>
        <span class="swatch" style=${styles}></span>
        <span>${this.prettyPlace(dialect.dialect)}</span>
      </span>
    `;
  }

  renderChart(dialect: Dialect, matches: Match[]) {
    const percent = matches.length / this.appState.currentInputData.length;
    const styles = styleMap({
      background: 'rgb(7, 163, 186)',
      width: `${(percent * 100).toFixed(0)}px`,
      display: 'inline-block',
      'margin-right': '5px'
    });
    const roundedPercent = Math.round(100 * percent);
    const percentText = (roundedPercent === 0 && matches.length !== 0) ? '<1' : roundedPercent;
    return html`
      <div>
        <div style=${styles}> </div>
        <span>${percent > 0 ? html`${percentText}%` : '-'}</span>
      </div>
    `;
  }

  renderTableForDialect(source: Source, rows: TableData[]) {
    const {fieldName} = source;

    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('dialect', true);
    columnVisibility.set('subregions', true);
    columnVisibility.set('words found', true);
    columnVisibility.set('% of examples', true);
    columnVisibility.set('matches', true);
    columnVisibility.set('matches.value', false);
    
    const getSortValue = (row: TableData, column: number) => {
      // matches button
      if (column === 4) {
        return row[5];
      }
      return row[column];
    }

    // TODO(lit-dev) handle reference selection, if in compare examples mode.
    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName="matches.value"
          defaultSortAscending=${false}
          selectionDisabled=${true}
          .columnVisibility=${columnVisibility}
          .data=${rows}
          .getSortValue=${getSortValue}
        ></lit-data-table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dialects-module': DialectsModule;
  }
}
