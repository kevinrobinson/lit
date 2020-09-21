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

import '../elements/checkbox';

// tslint:disable:no-new-decorators
import {customElement, html, property} from 'lit-element';
import {classMap} from 'lit-html/directives/class-map';
import {computed, observable} from 'mobx';

import {app} from '../core/lit_app';
import {LitModule} from '../core/lit_module';
import {IndexedInput, ModelsMap, Spec, TopKResult} from '../lib/types';
import {doesOutputSpecContain, findSpecKeys, flatten, isLitSubtype} from '../lib/utils';

import {styles} from './lm_branching_module.css';
import {styles as sharedStyles} from './shared_styles.css';

/**
 * A LIT module that renders masked predictions for a masked LM.
 */
@customElement('lm-branching-module')
export class LanguageModelBranchingModule extends LitModule {
  static title = 'LM Branching';
  static duplicateForExampleComparison = true;
  static duplicateAsRow = true;
  static numCols = 6;
  static template = (model = '', selectionServiceIndex = 0) => {
    return html`<lm-branching-module model=${model} selectionServiceIndex=${
        selectionServiceIndex}></lm-branching-module>`;
  };

  static get styles() {
    return [sharedStyles, styles];
  }

  // TODO(lit-dev): get this from the model spec?
  @property({type: String}) maskToken: string = '[MASK]';

  @observable private isExploring: boolean = false;
  @observable private predictionThreshold: number = 0.05;
  @observable private clickToMask: boolean = false;

  @observable private tokens: string[] = [];
  @observable private selectedInput: IndexedInput|null = null;
  // TODO(lit-dev): separate state from "ephemeral" preds in click-to-mask mode
  // from the initial model predictions.
  @observable private maskApplied: boolean = false;
  @observable private lmResults: TopKResult[][] = [];
  @observable private selectedTokenIndex: number|null = null;

  @computed
  private get predKey(): string {
    const spec = this.appState.getModelSpec(this.model);
    // This list is guaranteed to be non-empty due to checkModule()
    return findSpecKeys(spec.output, 'TokenTopKPreds')[0];
  }

  @computed
  private get outputTokensKey(): string {
    const spec = this.appState.getModelSpec(this.model);
    // This list is guaranteed to be non-empty due to checkModule()
    return spec.output[this.predKey].align as string;
  }

  @computed
  private get inputTokensKey(): string|null {
    const spec = this.appState.getModelSpec(this.model);
    // Look for an input field matching the output tokens name.
    if (spec.input.hasOwnProperty(this.outputTokensKey) &&
        isLitSubtype(spec.input[this.outputTokensKey], 'Tokens')) {
      return this.outputTokensKey;
    }
    return null;
  }

  @computed
  private get branches(): string[][] {
    var branches : string[][] = [this.tokens];

    // get unfinished paths...
    // var branch = [this.tokens[0]];
    // var i = 1;
    // while (i < this.tokens.length) {
    //   branches.push(branch.concat(this.tokens[i]));
    //   this.lmResults[i].forEach((pred: TopKResult) => {
    //     if (pred[0] === this.tokens[i]) return;
    //     if (pred[1] < this.predictionThreshold) return;
    //     branches.push(branch.concat(pred[0]));
    //   });
    //   branch.push(this.tokens[i])
    //   i += 1;
    // }

    // swap in alternate paths
    var left: string[] = [];
    var right: string[] = this.tokens.slice(1);
    var i = 0;
    while (i < this.tokens.length) {
      this.lmResults[i].forEach((pred: TopKResult) => {
        if (pred[0] === this.tokens[i]) return;
        if (pred[1] < this.predictionThreshold) return;
        branches.push(left.concat([pred[0]]).concat(right));
      });
      left.push(this.tokens[i]);
      right.shift();
      i += 1;
    }

    return branches;
  }

  firstUpdated() {
    const getSelectedInputData = () =>
        this.selectionService.primarySelectedInputData;
    this.reactImmediately(getSelectedInputData, async selectedInput => {
      await this.updateSelection(selectedInput);
      this.completeBranches();
    });
  }

  private async completeBranches() {
    if (this.selectedInput == null) {
      return;
    }

    const data = this.selectedInput.data;
    const branches = this.branches.map((branch: string[], index: number) => {
      return {
        id: '',
        data: Object.assign(
          {},
          data,
          { text: branch.concat(this.maskToken).join(' ') }
        ),
        meta: {}
      }
    });
    const dataset = this.appState.currentDataset;
    const promise = this.apiService.getPreds(
        branches, this.model, dataset, ['Tokens', 'TokenTopKPreds'],
        'Completing branches');
     const results = await this.loadLatest('modelPreds', promise);
    if (results === null) return;
  }

  private async updateSelection(selectedInput: IndexedInput|null) {
    this.selectedTokenIndex = null;
    if (selectedInput == null) {
      this.selectedInput = null;
      this.tokens = [];
      this.lmResults = [];
      return;
    }

    const dataset = this.appState.currentDataset;
    const promise = this.apiService.getPreds(
        [selectedInput], this.model, dataset, ['Tokens', 'TokenTopKPreds'],
        'Loading tokens');
    const results = await this.loadLatest('modelPreds', promise);
    if (results === null) return;

    const predictions = results[0];
    this.tokens = predictions[this.outputTokensKey];
    this.lmResults = predictions[this.predKey];
    this.selectedInput = selectedInput;
  }

  // TODO(lit-dev): unify this codepath with updateSelection()?
  // private async updateLmResults(maskIndex: number) {
  //   if (this.selectedInput == null) return;

  //   if (this.clickToMask) {
  //     if (this.inputTokensKey == null) return;
  //     const tokens = [...this.tokens];
  //     tokens[maskIndex] = this.maskToken;

  //     const inputData = Object.assign(
  //         {}, this.selectedInput.data, {[this.inputTokensKey]: tokens});
  //     // Use empty id to disable caching on backend.
  //     const inputs: IndexedInput[] =
  //         [{'data': inputData, 'id': '', 'meta': {}}];

  //     const dataset = this.appState.currentDataset;
  //     const promise = this.apiService.getPreds(
  //         inputs, this.model, dataset, ['TokenTopKPreds']);
  //     const lmResults = await this.loadLatest('mlmResults', promise);
  //     if (lmResults === null) return;

  //     this.lmResults = lmResults[0][this.predKey];
  //     this.maskApplied = true;
  //   }
  //   this.selectedTokenIndex = maskIndex;
  // }

  updated() {
    if (this.selectedTokenIndex == null) return;

    // // Set the correct offset for displaying the predicted tokens.
    // const inputTokenDivs = this.shadowRoot!.querySelectorAll('.token');
    // const maskedInputTokenDiv =
    //     inputTokenDivs[this.selectedTokenIndex] as HTMLElement;
    // const offsetX = maskedInputTokenDiv.offsetLeft;
    // const outputTokenDiv =
    //     this.shadowRoot!.getElementById('output-words') as HTMLElement;
    // outputTokenDiv.style.marginLeft = `${offsetX - 8}px`;
  }

  render() {
    return html`
      <div id="branching-root">
        <div class="branching-column">
          ${this.renderSlider()}
          <div id="branching-container">
            ${this.renderInputWords()}
            ${this.renderOutputWords()}
          </div>
         </div>
         <div class="branching-column right">
           ${this.renderControls()}
           ${this.renderBranches()}
         </div>
      </div>
    `;
  }

  renderControls() {
    return html`
      <div id='controls'>
        <button id="explore" @click=${this.onClickExplore}
          ?disabled="${this.isExploring}">
          Explore
        </button>
      </div>
    `;
  }

  renderSlider() {
    const defaultPredictionThreshold = 0.05;
    const [min, max, step] = [0.01, 0.99, 0.01];
    const val = this.predictionThreshold;
    const isDefaultValue = this.predictionThreshold === defaultPredictionThreshold;
    const reset = (e: Event) => {
      this.predictionThreshold = defaultPredictionThreshold;
    };
    const onChange = (e: Event) => {
      const newThreshold = +(e.target as HTMLInputElement).value;
      this.predictionThreshold = newThreshold;
    };
    return html`
      <div class="slider-row">
        <div>Prediction threshold:</div>
        <input type="range" min="${min}" max="${max}" step="${step}"
               .value="${val.toString()}" class="slider"
               @change=${onChange}>
        <div class="slider-label">&gt;${val}</div>
        <button @click=${reset}>Reset</button>
      </div>`;
  }

  onClickExplore() {
    alert('hi!');
    // this.isExploring = true;
    // if (this.lmResults === null) {
    //   return html``;
    // }
    // const lines = [];
    // this.tokens.forEach((token, index) => {

    // });
  }

  renderBranches() {
    if (this.tokens.length === 0) {
      return null;
    }

    const renderBranchToken = (token: string, index: number) => {
      const classes = classMap({
        token: true,
        diff: (token !== this.tokens[index])
      });
      return html`<div class=${classes}>${token}</div>`;
    }
    const renderBranch = (branch: string[]) => {
      return html`<div class="branch">${branch.map(renderBranchToken)}</div>`;
    };
    return html`
      <div id="branches">
        ${this.branches.map(renderBranch)}
      </div>
    `;
  }

  renderInputWords() {
    const renderToken = (token: string, i: number) => {
      const classes = classMap({
        token: true
      });
      return html`<div class=${classes}>${token}</div>`;
    };

    // clang-format on
    return html`
      <div id="lm-branching-input-words">
        ${this.tokens.map(renderToken)}
      </div>
    `;
    // clang-format off
  }

  renderOutputWords() {
    if (this.lmResults === null) {
      return html``;
    }
    const renderPred = (pred: TopKResult) => {
      const predWordType = pred[0];
      // Convert probability into percent.
      const predProb = (pred[1] * 100).toFixed(1);
      const classes = classMap({
        output: true,
        low: pred[1] < this.predictionThreshold
      });
      return html`<div class=${classes}>${predWordType} ${predProb}%</div>`;
    }
    const renderPreds = (preds: TopKResult[]) => {
      return html `<div class="lm-branches">${preds.map(renderPred)}</div>`;
    };

    // clang-format off
    return html`
      <div id="output-words">
        ${this.lmResults.map(renderPreds)}
      </div>
    `;
    // clang-format on
  }

  static shouldDisplayModule(modelSpecs: ModelsMap, datasetSpec: Spec) {
    // TODO(lit-dev): check for tokens field here, else may crash if not
    // present.
    return doesOutputSpecContain(modelSpecs, 'TokenTopKPreds');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'lm-branching-module': LanguageModelBranchingModule;
  }
}
