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
import numpy as np
from typing import Dict, Tuple, Iterator, List, Text, Optional
from absl import logging

import checklist
from checklist.editor import Editor

from lit_nlp.api import components as lit_components
from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import model as lit_model
from lit_nlp.api import types
from lit_nlp.lib import utils

JsonDict = types.JsonDict


# TODO(lit-dev)
class Generator(lit_components.Generator):
  # def __init__(self, seed=44):
  #   self.rng = random.Random(seed)

  # override
  # don't use this
  # def generate(self,
  #              example: JsonDict,
  #              model: lit_model.Model,
  #              dataset: lit_dataset.Dataset,
  #              config: Optional[JsonDict] = None) -> List[JsonDict]:
  #   return []

  # override
  # hacking; not connected to the number of examples selected
  def generate(self,
             example: JsonDict,
             model: lit_model.Model,
             dataset: lit_dataset.Dataset,
             config: Optional[JsonDict] = None) -> List[JsonDict]:
    del model  # Unused

    n_per_example = config.get('n_per_example', 10)
    template = config.get('template', None)
    if template is None:
      return []

    logging.info("Generating %d samples for template: %s ", n_per_example, template)
    output = []
    text_keys = utils.find_spec_keys(dataset.spec(), types.TextSegment)
    for text_key in text_keys:
      text_data = example[text_key]
      new_texts = self._expand(template, n_per_example)
      for new_text in new_texts:
        if new_text == text_data:
          continue
        output.append(self._new_example(example, text_key, new_text))

    return output

  def _new_example(self, example, text_key: Text, new_val: Text):
    new_example = copy.deepcopy(example)
    new_example[text_key] = new_val
    return new_example


  # TODO(lit-dev) set seed
  def _expand(self, template, n) -> List[Text]:
    editor = Editor()
    ret = editor.template(template, remove_duplicates=True)
    return list(np.random.choice(ret.data, n))
