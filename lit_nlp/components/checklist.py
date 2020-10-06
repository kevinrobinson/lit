# Copyright 2020 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ==============================================================================
# Lint as: python3
"""Word replacement generator."""

import copy
import re
from typing import Dict, Tuple, Iterator, List, Text, Optional

from absl import logging

import checklist
import spacy
from checklist.editor import Editor
from checklist.perturb import Perturb
import spacy

from lit_nlp.api import components as lit_components
from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import model as lit_model
from lit_nlp.api import types
from lit_nlp.lib import utils

JsonDict = types.JsonDict


def try_or(fn, default=None):
  return fn()
  # try:
  #   return fn()
  # except:
  #   return default

SPACIFY = 'spacify_transform'
WRAP = 'wrap_in_array'

# TODO(lit-dev) deps: checklist, spacy==2.2, python -m spacy download en_core_web_sm
class Explorer(lit_components.Generator):
  def __init__(self):
    self.nlp = spacy.load('en_core_web_sm')

  def _rules(self):
    return {
      'add_typos': [WRAP, Perturb.add_typos, {}],
      'expand_contractions': [WRAP, Perturb.contractions, {}],
      'contractions': [WRAP, Perturb.expand_contractions, {}],
      'change_names_first_only': [SPACIFY, Perturb.change_names,
        {'first_only' :True}],
      'change_names_last_only': [SPACIFY, Perturb.change_names,
        {'last_only' :True}],
      'change_names': [SPACIFY, Perturb.change_names, {}],
      'change_location': [SPACIFY, Perturb.change_location, {}],
      'change_number': [SPACIFY, Perturb.change_number, {}],
      'add_negation': [SPACIFY, Perturb.add_negation, {}],
      'remove_negation': [SPACIFY, Perturb.remove_negation, {}],
    }

  # override
  def generate_all(self,
                   inputs: List[JsonDict],
                   model: lit_model.Model,
                   dataset: lit_dataset.Dataset,
                   config: Optional[JsonDict] = None) -> List[List[JsonDict]]:
    # reservoir sampling
    n = config.get('n_max_samples') if config else 1000
    reservoir = []
    for ex in inputs:
      logging.info('example')
      new_examples = self.generate(ex, model, dataset, config)
      logging.info('new_examples: %d', len(new_examples))
      for t, new_example in enumerate(new_examples):
        if t < n:
          logging.info('append')
          reservoir.append(new_example)
        else:
          m = random.randint(0,t)
          if m < n:
            logging.info('replace')
            reservoir[m] = new_example

    logging.info("Reservoir sampling kept %d items", len(reservoir))
    return reservoir

  # override
  def generate(self,
               example: JsonDict,
               model: lit_model.Model,
               dataset: lit_dataset.Dataset,
               config: Optional[JsonDict] = None) -> List[JsonDict]:
    del model  # Unused.
    
    rule_keys = [config.get('rule_key')] if config else self._rules().keys()
    n_per_perturbation = config.get('n_per_perturbation') if config else 100

    output = []
    text_keys = utils.find_spec_keys(dataset.spec(), types.TextSegment)
    for text_key in text_keys:
      text_data = example[text_key]
      new_texts = self._expand(text_data, rule_keys, n=n_per_perturbation)
      for new_text in new_texts:
        if new_text == text_data:
          continue
        output.append(self._new_example(example, text_key, new_text))

    return output

  def _new_example(self, example, text_key, new_val):
    new_example = copy.deepcopy(example)
    new_example[text_key] = new_val
    return new_example

  def _transform_input_text(self, text, input_format):
    if input_format is SPACIFY:
      return list(self.nlp.pipe([text]))
    elif input_format is WRAP:
      return [text]
    else:
      return text

  def _attempts(self, rule_keys, text):
    attempts = []
    rules = self._rules()
    for rule_key in rule_keys:
      rule = rules.get(rule_key, None)
      if rule is None:
        continue
      print('attempt:')
      input_format, perturbation, params = rule
      checklist_input = self._transform_input_text(text, input_format)
      print(checklist_input)
      print(input_format)
      print(perturbation)
      print(params)
      print('----')
      attempt = try_or(lambda: Perturb.perturb(checklist_input, perturbation, **params))
      print(attempt)
      if attempt is not None:
        attempts.append(attempt)
    return attempts

  def _expand(self, text, rule_keys, n):
    # logging.info("Running for %s", text)
    attempts = self._attempts(rule_keys, text)
    uniques = set()
    perturbations = []
    for attempt in attempts:
      if attempt is None or len(attempt.get('data', [])) is 0:
        continue
      ds = [] if 'data' not in attempt else attempt['data'][0]
      for i in range(0, len(ds)):
        d = attempt['data'][0][i]
        meta = None if 'meta' not in attempt else attempt['meta'][0][i]
        if d not in uniques:
          uniques.add(d)
          perturbations.append({
            'data': d,
            'meta': meta
          })

    # Strip meta for now
    # logging.info("Expanded to %d perturbations.", len(perturbations))
    return list(p['data'] for p in perturbations)
