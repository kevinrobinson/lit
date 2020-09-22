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

/**
 * README
 */

import * as d3 from 'd3';
import {css, customElement, html, LitElement, property, svg} from 'lit-element';
import {classMap} from 'lit-html/directives/class-map';
import {styleMap} from 'lit-html/directives/style-map';

import {VizColor} from '../lib/colors';

// import {styles} from './span_graph_vis.css';

export interface Row {
  'before': number;
  'after': number;
  'delta': number;
  'tooltip': () => string
}


/* README */
@customElement('distribution-delta-vis')
export class DistributionDeltaVis extends LitElement {
  @property({type: Array}) rows: Row[] = [];

  updated() {
    console.log('updated');
    // set the dimensions and margins of the graph
    var margin = {top: 30, right: 30, bottom: 30, left: 60},
        width = 360 - margin.left - margin.right,
        height = 300 - margin.top - margin.bottom;

    // append the svg object to the body of the page
    var svg = d3.select(this.shadowRoot!.getElementById('svg'))
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform",
              "translate(" + margin.left + "," + margin.top + ")");


    // add the x Axis
    var x = d3.scaleLinear()
        .domain([-.25,.25])
        .range([0, width]);
    svg.append("g")
        .attr("transform", "translate(0," + height + ")")
        .call(d3.axisBottom(x));

    // add the first y Axis
    var y1 = d3.scaleLinear()
              .range([height/2, 0])
              .domain([0, 0.12]);
    svg.append("g")
      .attr("transform", "translate(-20,0)")
      .call(d3.axisLeft(y1).tickValues([0.05, 0.1]));

    // add the first y Axis
    var y2 = d3.scaleLinear()
              .range([height/2, height])
              .domain([0, 0.12]);
    svg.append("g")
        .attr("transform", "translate(-20,0)")
        .call(d3.axisLeft(y2).ticks(2).tickSizeOuter(0));

    // Compute kernel density estimation
    var kde = kernelDensityEstimator(kernelEpanechnikov(7), x.ticks(20))
    var density1 =  kde(this.rows.map(d => +d.before));
    var density2 =  kde(this.rows.map(d => +d.after));

    // Plot the area
    svg.append("path")
        .attr("class", "mypath")
        .datum(density1)
        .attr("fill", "#69b3a2")
        .attr("opacity", ".6")
        .attr("stroke", "#000")
        .attr("stroke-width", 1)
        .attr("stroke-linejoin", "round")
        .attr("d",  d3.line()
          .curve(d3.curveBasis)
            .x(function(d) { return x(d[0]); })
            .y(function(d) { return y1(d[1]); })
        );

    // Plot the area
    svg.append("path")
        .attr("class", "mypath")
        .datum(density2)
        .attr("fill", "#404080")
        .attr("opacity", ".6")
        .attr("stroke", "#000")
        .attr("stroke-width", 1)
        .attr("stroke-linejoin", "round")
        .attr("d",  d3.line()
          .curve(d3.curveBasis)
            .x(function(d) { return x(d[0]); })
            .y(function(d) { return y2(d[1]); })
        );

    // Handmade legend
    // svg.append("circle").attr("cx",290).attr("cy",30).attr("r", 6).style("fill", "#69b3a2")
    // svg.append("circle").attr("cx",290).attr("cy",60).attr("r", 6).style("fill", "#404080")
    // svg.append("text").attr("x", width).attr("y", 30).text("before").style("font-size", "15px").attr("alignment-baseline","middle")
    // svg.append("text").attr("x", width).attr("y", 60).text("after").style("font-size", "15px").attr("alignment-baseline","middle")

    // Function to compute density
    function kernelDensityEstimator(kernel: any, X: any) {
      return function(V: any) {
        return X.map(function(x: any) {
          console.log('kde, x:', x, 'X:', X);
          return [x, d3.mean(V, function(v: any) { return kernel(x - v); })];
        });
      };
    }
    function kernelEpanechnikov(k: any) {
      return function(v: number) {
        return Math.abs(v /= k) <= 1 ? 0.75 * (1 - v * v) / k : 0;
      };
    }
  }

  render() {
    return svg`
      <svg id='svg' xmlns='http://www.w3.org/2000/svg'></svg>`;
  }
}

/* README */
declare global {
  interface HTMLElementTagNameMap {
    'distribution-delta-vis': DistributionDeltaVis;
  }
}
