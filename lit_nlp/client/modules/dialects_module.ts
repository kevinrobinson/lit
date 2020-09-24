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
  @property({type: Object}) us = null;

  constructor() {
    super();
    this.wordToDialect = buildMap();
    this.cityToLocation = buildGeocoder();
  }

  onSelect(selectedRowIndices: number[]) {
    const ids = selectedRowIndices
                    .map(index => this.appState.currentInputData[index]?.id)
                    .filter(id => id != null);
    this.selectionService.selectIds(ids);
  }

  onPrimarySelect(index: number) {
    const id = (index === -1)
      ? null
      : this.appState.currentInputData[index]?.id ?? null;
    this.selectionService.setPrimarySelection(id);
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

    return svg`
      <svg id='svg' viewBox="0 0 975 610" xmlns='http://www.w3.org/2000/svg'>
        <g fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">
          <path stroke="#eee" stroke-width="0.5" d="${path(topojson.mesh(us, us.objects.counties, (a, b) => a !== b && (a.id / 1000 | 0) === (b.id / 1000 | 0)))}"></path>
          <path stroke="#999" stroke-width="0.5" d="${path(topojson.mesh(us, us.objects.states, (a, b) => a !== b))}"></path>
          <path stroke="#333" d="${path(topojson.feature(us, us.objects.nation))}"></path>
          ${this.renderCities()}
        </g>
      </svg>
    `;
  }

  renderCities() {
    if (this.cityToLocation === {}) {
      return;
    }
    if (this.plottableCities.length === 0) {
      return;
    }

    return svg`
      <g class="cities">
        ${this.renderCities()}
      </g>
    `;
  }

  @computed
  get dialectColor() {
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
    this.plottableCities.map(({dialect}) => colorScale(dialect.dialect));
    return colorScale;
  }

  @computed
  get plottableCities() {
    const plottableCities = [];
    this.dialects.forEach(dialect => {
      const regions = (dialect.subregions || '').toLowerCase().split(',');
      regions.forEach(region => {
        const latLon = this.cityToLocation[region];
        if (latLon == null) {
          return;
        }
        plottableCities.push({
          name: this.prettyPlace(region),
          dialect,
          lat: latLon.lat,
          lon: latLon.lon
        });
      });
    });

    return plottableCities;
  }

  // for both SVG and HTML
  stylesForDialect(dialect: Dialect) {
    const matches = this.matchesByDialect[dialect.dialect] || [];
    if (matches.length === 0) {
      return {};
    }

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
            console.log('projection', lon, lat, p);
            return null;
          }

          const matches = this.matchesByDialect[dialect.dialect] || [];
          if (matches.length === 0) {
            return null;
          }

          // format circle
          const color = this.dialectColor(dialect.dialect);
          const percent = matches.length / this.appState.currentInputData.length;
          const styles = styleMap(this.stylesForDialect(dialect));
          const transform = `translate(${p.join(",")})`;
          return svg`
            <g transform=${transform}>
              <circle class="city" r="5" style=${styles} />
              <text class="city-text" y="-6">${name}</text>
            </g>
          `;
        })}
      </g>
    `;

//     // draw points
//     svg.selectAll("circle")
//         .data(values[1])
//         .enter()
//         .append("circle")
//         .attr("class","circles")
//         .attr("cx", function(d) {return projection([d.Longitude, d.Lattitude])[0];})
//         .attr("cy", function(d) {return projection([d.Longitude, d.Lattitude])[1];})
//         .attr("r", "1px"),
// // add labels
//     svg.selectAll("text")
//         .data(values[1])
//         .enter()
//         .append("text")
//         .text(function(d) {
//             return d.City;
//             })
//         .attr("x", function(d) {return projection([d.Longitude, d.Lattitude])[0] + 5;})
//         .attr("y", function(d) {return projection([d.Longitude, d.Lattitude])[1] + 15;})
//         .attr("class","labels");
  }

  // // super
  // updated() {
  //   this.updateMap();
  // }

  // async updateMap() {
  //   const el = this.shadowRoot!.querySelector('#map svg');

  //   const us = await d3.json("https://unpkg.com/us-atlas@3/counties-albers-10m.json");
  //   us.objects.lower48 = {
  //     type: "GeometryCollection",
  //     geometries: us.objects.states.geometries.filter(d => d.id !== "02" && d.id !== "15")
  //   };
  //   const width = 300;
  //   const height = 200;
  //   // projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305])
  //   // const projection = d3.geoEqualEarth();
  //   // const projection = d3.geoAlbersUsa().fitSize([width, height], us.bbox);
  //   // const projection = d3.geoAlbersUsa().scale(130).translate([-300, -100])
  //   const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  //   const path = d3.geoPath().projection(projection);

  //   const svg = d3.select(el)
  //     .attr('viewBox', '0 0 975 610')
  //     .attr("width", 975)
  //     .attr("height", 610);
  //     // .attr('width', `${width}px`)
  //     // .attr('height', `${height}px`)
  //     // .style("width", "100%")
  //     // .style("height", "100%");

  //   svg.append("path")
  //       .datum(topojson.merge(us, us.objects.lower48.geometries))
  //       .attr("fill", "#ddd")
  //       .attr("d", path);

  //   svg.append("path")
  //       .datum(topojson.mesh(us, us.objects.lower48, (a, b) => a !== b))
  //       .attr("fill", "none")
  //       .attr("stroke", "white")
  //       .attr("stroke-linejoin", "round")
  //       .attr("d", path);

    // const g = svg.append("g")
    //     .attr("fill", "red")
    //     .attr("stroke", "black");

    // el.appendChild(svg.node());

 // svg.append("circle")
 //      .attr("fill", "blue")
 //      .attr("transform", `translate(${data[0]})`)
 //      .attr("r", 3);



    // topojson = require("topojson-client@3")
//     const el = this.shadowRoot!.querySelectorAll('#map');
//     // const map = d3.choropleth()
//     //   .geofile(geofile)
//     //   .projection(d3.geoAlbersUsa)
//     //   .column('2012')
//     //   .unitId('fips')
//     //   .scale(1000)
//     //   .legend(true)
//    const [width, height] = [300, 200];
//    const projection = d3.geoEqualEarth();
//    projection.fitSize([width, height], bb);
//  5  let geoGenerator = d3.geoPath()
//  6  .projection(projection);
//  7
//  8  let svg = d3.select("body").append('svg')
//  9  .style("width", width).style("height", height);
// 10
// 11  svg.append('g').selectAll('path')
// 12  .data(bb.features)
// 13  .join('path')
// 14  .attr('d', geoGenerator)
// 15  .attr('fill', '#088')
// 16  .attr('stroke', '#000');

//     const csv = `,State,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,fips
// 0,Alabama,0.77,0.59,2.3,0.67,0.46,0.23,0.27,0.13,0.12,0.19,0.14,0.26,0.0,0.02,0.13,US01
// 1,Alaska,0.0,0.0,0.14,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,US02
// 2,Arizona,1.51,2.14,0.21,1.16,1.11,0.39,0.51,0.06,1.1,0.78,0.8,0.44,0.34,0.89,0.83,US04
// 3,Arkansas,0.11,0.39,9.15,0.15,0.13,0.01,0.04,1.39,0.42,0.0,0.0,0.0,0.05,0.0,0.05,US05
// 4,California,7.14,19.14,32.61,12.46,6.87,5.86,5.95,6.52,6.99,7.88,7.51,5.06,5.95,7.92,7.08,US06`;
//     d3.csv.parse('/data/venture-capital.csv').then(data => {
//       map.draw(d3.select(el).datum(data));
//     });
  // }

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

  @computed get matchesByDialect():{[dialect: string]: Match} {
    const matchesByDialect:{[dialect: string]: IndexedInput[]} = {};
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

    const wordsText = [
      matches.map(match => match.word).slice(0, 3).join(', '),
      (matches.length > 3) ? ` +${matches.length - 3} more` : ''
    ].join('');

    // const buttonStyles = styleMap({
    //   'padding-left'
    // }
    const row: TableData = [
      this.renderDialectWithSwatch(dialect),
      subregionsText,
      wordsText,
      this.renderChart(dialect, matches),
      matches.length > 0 ? html`<button>${matches.length} datapoints</button` : '-',
      +matches.length
    ];
    return row;
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
    return html`
      <div>
        <div style=${styles}> </div>
        <span>${percent > 0 ? html`${Math.round(100 * percent)}%` : '-'}</span>
      </div>
    `;
  }

  renderTableForDialect(source: Source, rows: TableData[]) {
    const {fieldName} = source;

    const columnVisibility = new Map<string, boolean>();
    columnVisibility.set('dialect', true);
    columnVisibility.set('subregions', true);
    columnVisibility.set('words', true);
    columnVisibility.set('prevalance', true);
    columnVisibility.set('matches', true);
    columnVisibility.set('matches.value', false);
    
    const getSortValue = (row: TableData, column: number) => {
      // matches button
      if (column === 4) {
        return row[5];
      }
      return row[column];
    }
    const primarySelectedIndex =
      this.appState.getIndexById(this.selectionService.primarySelectedId);

    // TODO(lit-dev) handle reference selection, if in compare examples mode.
    return html`
      <div class="table-container">
        <lit-data-table
          defaultSortName="matches.value"
          defaultSortAscending=${false}
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
