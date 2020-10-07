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
"""TODO(lit-dev)"""

import random
import copy
import re
from typing import Dict, Tuple, Iterator, List, Text, Optional

from absl import logging

import checklist
from checklist.editor import Editor
from checklist.perturb import Perturb
import spacy

from lit_nlp.api import components as lit_components
from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import model as lit_model
from lit_nlp.api import types
from lit_nlp.lib import utils

JsonDict = types.JsonDict


SPACIFY = 'spacify_transform'
WRAP = 'wrap_in_array'

DEFAULT_LANGUAGE = 'en_core_web_sm'

# TODO(lit-dev) deps: checklist, spacy==2.2
# ... python -m spacy download en_core_web_sm / es_core_news_sm / etc.
# ... not sure how to do this on-demand in Python
class Generator(lit_components.Generator):
  def __init__(self, seed=43, swallow_add_negation_exceptions=True):
    self.swallow_add_negation_exceptions = swallow_add_negation_exceptions
    self.language_key = DEFAULT_LANGUAGE
    self.nlp = None
    self.rng = random.Random(seed)

  # Define how to map `rule_key` values to checklist method calls 
  # (input transformation key, perturbation method, params)
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

  def _ensure_spacy_is_loaded(self, config: Optional[JsonDict] = None):
    language_key = config.get('language_key', DEFAULT_LANGUAGE) if config else DEFAULT_LANGUAGE
    if self.nlp is None or self.language_key != language_key:
      logging.info('Loading language_key: %s...', language_key)
      self.nlp = spacy.load(language_key)

  # override
  def generate(self,
               example: JsonDict,
               model: lit_model.Model,
               dataset: lit_dataset.Dataset,
               config: Optional[JsonDict] = None) -> List[JsonDict]:
    del model  # Unused.
    self._ensure_spacy_is_loaded(config) # could delay this further
    
    rule_keys = [config.get('rule_key')] if config else self._rules().keys()
    n_per_example = int(config.get('n_per_example', 10)) if config else 10
    # n_per_perturbation = int(config.get('n_per_perturbation', 100)) if config else 100

    output = []
    text_keys = utils.find_spec_keys(dataset.spec(), types.TextSegment)
    for text_key in text_keys:
      text_data = example[text_key]
      new_texts = self._expand(text_data, rule_keys)
      for new_text in new_texts:
        if new_text == text_data:
          continue
        output.append(self._new_example(example, text_key, new_text))

    # enforce: n_per_example
    if len(output) > n_per_example:
      return self.rng.sample(output, n_per_example)
    else:
      return output

  def _new_example(self, example, text_key: Text, new_val: Text):
    new_example = copy.deepcopy(example)
    new_example[text_key] = new_val
    return new_example

  def _transform_input_text(self, text: Text, input_format):
    if input_format is SPACIFY:
      return list(self.nlp.pipe([text]))
    elif input_format is WRAP:
      return [text]
    else:
      return text

  # Transform `text` and apply each perturbation in `rule_keys`, extracting
  # the perturbed text.  Return a list of perturbations after de-duping.
  def _expand(self, input_text, rule_keys) -> List[Text]:
    output_texts = set()
    rules = self._rules()
    for rule_key in rule_keys:
      rule = rules.get(rule_key, None)
      if rule is None:
        continue
      
      # run the perturbation
      input_format, perturbation, params = rule
      checklist_input = self._transform_input_text(input_text, input_format)
      attempt = self._wrap_perturbation(rule_key, checklist_input, perturbation, params)
      if attempt is None:
        continue
      
      # get each new perturbation text that was produced
      ds = attempt.get('data', [])
      perturbed_texts = [] if len(ds) is 0 else ds[0]
      for text in perturbed_texts:
        if text in output_texts:
          continue
        output_texts.add(text)
    
    return list(output_texts)

  # hacking around bug in checklist for add_negation,
  # see https://github.com/marcotcr/checklist/pull/43 
  def _wrap_perturbation(self, rule_key: str, checklist_input: str, perturbation,
    params: Dict) -> Optional[Dict]:
    if self.swallow_add_negation_exceptions and rule_key == 'add_negation':
      try:
        return Perturb.perturb(checklist_input, perturbation, **params)
      except:
        return None

    return Perturb.perturb(checklist_input, perturbation, **params)
