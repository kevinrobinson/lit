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
 * Module within LIT the model's attention for a single input
 */

// tslint:disable:no-new-decorators
import {customElement, html, property, svg} from 'lit-element';
import {observable, reaction} from 'mobx';
import {styleMap} from 'lit-html/directives/style-map';

import {app} from '../core/lit_app';
import {LitModule} from '../core/lit_module';
import {IndexedInput, ModelsMap, Spec} from '../lib/types';
import {cumSumArray, doesOutputSpecContain, findSpecKeys, sumArray} from '../lib/utils';

import {styles as sharedStyles} from './shared_styles.css';

type Tokens = string[];
// <float>[num_heads, num_tokens, num_tokens]
type AttentionHeads = number[][][];

/**
 * A LIT module that renders the model's attention for a single input.
 */
@customElement('attention-module')
export class AttentionModule extends LitModule {
  static title = 'Attention';
  static numCols = 6;
  static duplicateForExampleComparison = true;
  static template = (model = '', selectionServiceIndex = 0) => {
    return html`<attention-module model=${model} selectionServiceIndex=${
        selectionServiceIndex}></attention-module>`;
  };

  static get styles() {
    return sharedStyles;
  }

  @observable private selectedLayer?: string;
  @observable private selectedHeadIndex: number = 0;
  @observable private preds?: {[key: string]: Tokens|AttentionHeads};

  firstUpdated() {
    const getSelectedInput = () =>
        this.selectionService.primarySelectedInputData;
    this.reactImmediately(getSelectedInput, selectedInput => {
      this.updateSelection(selectedInput);
    });
  }

  private async updateSelection(selectedInput: IndexedInput|null) {
    if (selectedInput === null) {
      this.preds = undefined;
    } else {
      const dataset = this.appState.currentDataset;
      const promise = this.apiService.getPreds(
          [selectedInput], this.model, dataset, ['Tokens', 'AttentionHeads'],
          'Fetching attention');
      const res = await this.loadLatest('attentionAndTokens', promise);
      if (res === null) return;
      this.preds = res[0];
    }
  }

  render() {
    // return null;
    if (this.preds) {
      // <div>
      //   ${this.renderAttnHeadDropdown()}
      //   ${this.renderIdxDropdown()}
      // </div>
      return html`
        ${this.renderVisual()}
      `;
    }
    // If the input was cleared (so there is no data to show), hide everything
    return null;
  }

  private renderVisual() {
    const styles = styleMap({
      'display': 'flex',
      'flex-direction': 'row'
    });

    const outputSpec = this.appState.currentModelSpecs[this.model].spec.output;
    const attnKeys = findSpecKeys(outputSpec, 'AttentionHeads');
    if (attnKeys.length === 0) {
      return html `<div>No AttentionHeads found.</div>`;
    }

    const numHeadsPerLayer = this.preds![attnKeys[0]].length;
    const headIndexes = Array.from(Array(numHeadsPerLayer).keys());
    return html`
      <div style=${styles}>
        ${headIndexes.map(headIndex => this.renderHeadAcrossLayers(headIndex))};
      }
      </div>
    `;
    // const heads = this.preds![this.selectedLayer!] as AttentionHeads;
  }

  private renderHeadAcrossLayers(headIndex: number) {
    // ${Object.keys(this.preds!).map(predKey => this.renderAttnHeadForLayer(predKey))}
    const styles = styleMap({
      'display': 'flex',
      'flex-direction': 'column'
    });

    // TODO(lit-dev) weak assumption on ordering
    const predKeys = Object.keys(this.preds!);
    return html`
      <div>
        <h2>head: ${headIndex}</h2>
        <div style=${styles}>
          ${predKeys.map(predKey => this.renderAttnHeadForLayer(predKey, headIndex))}
        </div>
      </div>
    `;
    // const heads = this.preds![predKey!] as AttentionHeads;
    // return html`<pre>${JSON.stringify(heads, null, 2)}</pre>`;
  }

  private renderAttnHeadForLayer(predKey: string, headIndex: number) {
    const outputSpec = this.appState.currentModelSpecs[this.model].spec.output;
    // const attnKeys = findSpecKeys(outputSpec, 'AttentionHeads');
    const fieldSpec = outputSpec[predKey];
    if (!fieldSpec) {
      return html`<div>No AttentionHeads in the model's output spec</div>`;
    }
    const heads = this.preds![predKey!] as AttentionHeads;
    const align = fieldSpec!.align as [string, string];
    if (!align) {
      return null;
    }

    // Tokens involved in the attention.
    const inToks = (this.preds!)[align[0]] as Tokens;
    const outToks = (this.preds!)[align[1]] as Tokens;

    const inTokLens = inToks.map(tok => tok.length + 1);
    const outTokLens = outToks.map(tok => tok.length + 1);

    const inTokStr = svg`out:${inToks.join(' ')}`;
    const outTokStr = svg`${outToks.join(' ')}`;

    // Character width is constant as this is a fixed width font.
    const charWidth = 6.5;
    const fontSize = 12;

    // Height of the attention visualization part.
    const visHeight = 100;

    // Vertical pad between attention vis and words.
    const pad = 10;

    // Calculate the full width and height.
    const width =
        Math.max(sumArray(inTokLens), sumArray(outTokLens)) * charWidth;
    const height = visHeight + fontSize * 2 + pad * 4;

    const container = styleMap({
      'position': 'relative'
    });
    const overlay = styleMap({
      'position': 'absolute',
      'top': '0',
      'opacity': '0'
    });

    const onClick = () => {
      console.log(headIndex, predKey, JSON.stringify(heads[headIndex], null, 2));
    }
    // clang-format off
    return html`
      <div style=${container}>
        <div style=${overlay}>${predKey}</div>
        <svg width=${200} height=${20} viewBox="0 30 1000 100"
          font-family="'Share Tech Mono', monospace"
          font-size="${fontSize}px"
          @click=${onClick}>
          <text y=${pad * 2}> ${outTokStr}</text>
          ${this.renderAttnLines(heads, headIndex, visHeight, charWidth, 2.5 * pad, inTokLens, outTokLens)}
          <text y=${visHeight + 4 * pad}> ${inTokStr}</text>
        </svg>
      </div>
    `;
    // clang-format on
  }



  /**
   * Render the actual lines between tokens to show the attention values.
   */
  private renderAttnLines(
      heads: AttentionHeads, headIndex: number,
      visHeight: number, charWidth: number, pad: number,
      inTokLens: number[], outTokLens: number[]) {
    const cumSumInTokLens = cumSumArray(inTokLens);
    const cumSumOutTokLens = cumSumArray(outTokLens);
    const y1 = pad;
    const y2 = pad + visHeight;

    const xIn = (i: number) =>
        (cumSumInTokLens[i] - inTokLens[i] / 2) * charWidth;
    const xOut = (i: number) =>
        (cumSumOutTokLens[i] - outTokLens[i] / 2) * charWidth;

    
    // clang-format off
    return heads[headIndex].map(
        (attnVals: number[], i: number) => {
          return svg`
            ${attnVals.map((attnVal: number, j: number) => {
              return svg`
                <line
                  x1=${xIn(j)}
                  y1=${y1}
                  x2=${xOut(i)}
                  y2=${y2}
                  stroke="rgba(100,3,250,${attnVal})"
                  stroke-width=2>
                </line>`;
          })}`;
        });
    // clang-format on
  }

  /**
   * Render the dropdown with the layer names.
   */
  private renderAttnHeadDropdown() {
    const outputSpec = this.appState.currentModelSpecs[this.model].spec.output;
    const attnKeys = findSpecKeys(outputSpec, 'AttentionHeads');
    if (this.selectedLayer === undefined) {
      this.selectedLayer = attnKeys[0];
    }
    const onchange = (e: Event) => this.selectedLayer =
        (e.target as HTMLSelectElement).value;
    return html`
        <select class="dropdown" @change=${onchange}>
          ${attnKeys.map(key => {
      return html`<option value=${key}>${key}</option>`;
    })}
        </select>`;
  }

  /**
   * Render the dropdown for the attention head index.
   */
  private renderIdxDropdown() {
    const numHeadsPerLayer = this.preds![this.selectedLayer!].length;
    const numHeadsPerLayerRange =
        Array.from({length: numHeadsPerLayer}, (x: string, i: number) => i);
    const onchange = (e: Event) => this.selectedHeadIndex =
        Number((e.target as HTMLSelectElement).value);
    return html`
    <select class="dropdown" @change=${onchange}>
      ${numHeadsPerLayerRange.map(key => {
      return html`<option value=${key}>${key}</option>`;
    })}
    </select>`;
  }

  static shouldDisplayModule(modelSpecs: ModelsMap, datasetSpec: Spec) {
    return doesOutputSpecContain(modelSpecs, 'AttentionHeads');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'attention-module': AttentionModule;
  }
}
