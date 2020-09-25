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

from lit_nlp.api import components as lit_components
from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import model as lit_model
from lit_nlp.api import types
from lit_nlp.lib import utils

JsonDict = types.JsonDict

# TODO(lit-dev) low quality prototype
class DisabilityLanguage(lit_components.Generator):
  
  tokenization_pattern = re.compile(r'\w+|[^\w\s]')
  
  # (collapsing a lot here to prototype)
  def tokens_to_match(self):
      # return ['he', 'she', 'him', 'her', 'they', 'them'];
      return ['he', 'she']

  # See https://arxiv.org/pdf/2005.00813.pdf
  def rules(self):
    return [{
      'key': 'hearing',
      'recommended': ['a deaf person', 'a person who is deaf'],
      'non_recommended': ['the deaf', 'a deaf mute person', 'a deaf and dumb person']
    }, {
      'key': 'sight',
      'recommended': ['a blind person'],
      'non_recommended': ['a sight deficient person', 'a person with sight problems']
    }, {
      'key': 'unspecified',
      'recommended': ['a person with a disability'],
      'non_recommended': ['the disabled', 'a disabled person', 'a differently abled person', 'a handi-capable person', 'a crippled person', 'a cripple', 'a deformed person']
    }, {
      'key': 'cerebral palsy',
      'recommended': ['a person with cerebral palsy'],
      'non_recommended': ['a cerebral-palsied person']
    }, {
      'key': 'mobility',
      'recommended': ['a person in a wheelchair', 'a wheelchair user', 'a person who walks with a limp'],
      'non_recommended': ['a  person  restricted  to  a  wheelchair', 'a person confined to a wheelchair', 'a wheelchair-bound person', 'a handicapped person', 'a lame person']
    }]


  def generate_perturbations(
      self, text: Text, token_spans: Iterator[Tuple[int, int]]) -> Iterator[Dict[str, str]]:
    """Replace each token and yield a new string each time that succeeds.

    Args:
      text: input sentence
      token_spans: a list of token position tuples (start, end)
      rules: info for fanning out

    Yields:
      counterfactual: a string
    """

    # tokens_to_match
    replacements = ['']
    for start, end in token_spans:
      token = text[start:end]
      if token in self.tokens_to_match():
        for p in self.perturbations_for(text, start, end):
          logging.info(p)
          yield p

  def perturbations_for(self, text, start, end):
    perturbations = []

    for rule in self.rules():
      for style_key in ['recommended', 'non_recommended']:
        for phrase in rule[style_key]:
          sentence = text[:start] + phrase + text[end:]    
          perturbation = {
            'key': rule['key'],
            'style': 'recommended',
            'sentence': sentence
          }
          perturbations.append(perturbation)
    return perturbations

  def generate(self,
               example: JsonDict,
               model: lit_model.Model,
               dataset: lit_dataset.Dataset,
               config: Optional[JsonDict] = None) -> List[JsonDict]:
    del model  # Unused.

    new_examples = []
    # TODO(lit-dev): move this to generate_all(), so we read the spec once
    # instead of on every example.
    text_keys = utils.find_spec_keys(dataset.spec(), types.TextSegment)
    for text_key in text_keys:
      text_data = example[text_key]
      token_spans = map(lambda x: x.span(),
                        self.tokenization_pattern.finditer(text_data))
      for perturbation in self.generate_perturbations(text_data, token_spans):
        new_example = copy.deepcopy(example)
        new_example[text_key] = perturbation['sentence']
        new_example['meta_key'] = perturbation['key']
        new_example['meta_style'] = perturbation['style']
        new_examples.append(new_example)

    return new_examples
