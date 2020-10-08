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
from lit_nlp.lib import serialize

JsonDict = types.JsonDict


# TODO(lit-dev)
class Generator(lit_components.Generator):
  def __init__(self):
    self.editor = None

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

    self._ensure_editor(config)
    template = config.get('template', None)
    n_per_example = int(config.get('n_per_example', 3))
    vocab_map = config.get('vocab_map', {})
    print(config)
    print(vocab_map)
    if template is None or self.editor is None:
      return []

    logging.info("Generating %d samples for template: %s ", n_per_example, template)
    output = []
    text_keys = utils.find_spec_keys(dataset.spec(), types.TextSegment)
    for text_key in text_keys:
      text_data = example[text_key]
      new_texts = self._expand(template, vocab_map, n_per_example)
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
  def _expand(self, template, vocab_map, n) -> List[Text]:
    # TODO(lit-dev) security hole with user input as kwargs
    ret = self.editor.template(template, remove_duplicates=True, nsamples=n, **vocab_map)
    return list(np.random.choice(ret.data, n))

  def _ensure_editor(self, config):
    if self.editor is None:
      language_code = config.get('language_code', None)
      self.editor = Editor(language=language_code)
    return self.editor


import munch


# TODO(lit-dev) audit for unsafe handling of user input (eg, magic tokens)
def template(self, templates, nsamples=None,
             product=True, remove_duplicates=False, mask_only=False,
             unroll=False, labels=None, meta=False,  save=False, **kwargs):
    """Fills in templates
    Parameters
    ----------
    templates : str, list, tuple, or dict
        On leaves: templates with {tags}, which will be substituted for mapping in **kwargs
        Can have {mask} tags, which will be replaced by a masked language model.
        Other tags can be numbered for distinction, e.g. {person} and {person1} will be considered
        separate tags, but both will use fill-ins for 'person'
    nsamples : int
        Number of samples
    product : bool
        If true, take cartesian product
    remove_duplicates : bool
        If True, will not generate any strings where two or more fill-in values are duplicates.
    mask_only : bool
        If True, return only fill-in values for {mask} tokens
    unroll : bool
        If True, returns list of strings regardless of template type (i.e. unrolls)
    labels : int or object with strings on leaves
        If int, all generated strings will have the same label. Otherwise, can refer
        to tags, or be strings, etc. Output will be in ret.meta
    meta : bool
        If True, ret.meta will contain a dict of fill in values for each item in ret.data
    save : bool
        If True, ret.templates will contain all parameters and fill-in lists
    **kwargs : type
        Must include fill-in lists for every tag not in editor.lexicons
    Returns
    -------
    MunchWithAdd
        Returns ret, a glorified dict, which will have the filled in templates in ret.data.
        It may contain ret.labels, ret.templates and ret.meta (depending on parameters as noted above)
        You can add or += two MunchWithAdd, which will concatenate values
    """

# 1. go through object, find every attribute inside brackets
# 2. check if they are in kwargs and self.attributes
# 3. generate keys and vals
# 4. go through object, generate
    params = locals()
    ret = MunchWithAdd()
    del params['kwargs']
    del params['self']
    templates = copy.deepcopy(templates)
    added_labels = False
    if labels is not None and type(labels) != int:
        added_labels = True
        templates = (templates, labels)
    all_keys = find_all_keys(templates)
    items = self._get_fillin_items(all_keys, **kwargs)
    mask_index, mask_options = get_mask_index(templates)

    for mask, strings in mask_index.items():
        # ks = {re.sub(r'.*?:', '', a): '{%s}' % a for a in all_keys}
        ks = {}
        tok = 'VERYLONGTOKENTHATWILLNOTEXISTEVER'
        ks[mask] = tok
        a_tok = 'thisisaratherlongtokenthatwillnotexist'
        # print(mask)
        # print('options:', mask_options[mask])
        top = 100
        find_top = re.search(r't(\d+)', mask_options[mask])
        if find_top:
            top = int(find_top.group(1))
        sub_a = lambda x: re.sub(r'{[^:}]*a[^:}]*:(%s)}' % mask, r'{%s} {\1}' % a_tok, x)
        # print(strings)
        strings = recursive_apply(strings, sub_a)
        ks[a_tok] = '{%s}' % a_tok
        # print(strings)
        ts = recursive_format(strings, ks, ignore_missing=True)
        np.random.seed(1)
        samp = self.template(ts, nsamples=5, remove_duplicates=remove_duplicates,
                             thisisaratherlongtokenthatwillnotexist=['a'], **kwargs).data
        samp += self.template(ts, nsamples=5, remove_duplicates=remove_duplicates,
                             thisisaratherlongtokenthatwillnotexist=['an'], **kwargs).data
        # print(samp)
        # print(len([x for x in samp if ' an ' in x[0]]))
        samp = [x.replace(tok, self.tg.tokenizer.mask_token) for y in samp for x in y][:20]
        samp = list(set(samp))
        # print(samp)
        if 'beam_size' not in kwargs:
            kwargs['beam_size'] = 100
        # beam_size = kwargs.get('beam_size', 100)
        # kwargs.
        options = self.tg.unmask_multiple(samp, **kwargs)
        # print(options)
        # print(top)
        v = [x[0] for x in options][:top]
        items[mask] = v
        if mask_only:
            return options[:nsamples]
    if save:
        ret.templates = [(params, items)]
    templates = recursive_apply(templates, replace_mask)
    # print(templates)
    keys = [x[0] for x in items.items()]
    vals = [[x[1]] if type(x[1]) not in [list, tuple] else x[1] for x in items.items()]
    if nsamples is not None:
        # v = [np.random.choice(x, nsamples) for x in vals]
        v = [wrapped_random_choice(x, nsamples) for x in vals]
        if not v:
            vals = [[]]
        else:
            vals = zip(*v)
        # print(list(vals))
    else:
        if not product:
            vals = zip(*vals)
        else:
            vals = itertools.product(*vals)
    data = []
    use_meta = meta
    meta = []
    for v in vals:
        # print(v)
        if remove_duplicates and len(v) != len(set([str(x) for x in v])):
            continue
        mapping = dict(zip(keys, v))
        # print(templates)
        # print(mapping)
        data.append(recursive_format(templates, mapping))
        meta.append(mapping)
    if unroll and data and type(data[0]) in [list, np.array, tuple]:
        data = [x for y in data for x in y]
        meta = [x for y in meta for x in y]
    if use_meta:
        ret.meta = meta
    if added_labels:
        data, labels = map(list, zip(*data))
        ret.labels = labels
    if labels is not None and type(labels) == int:
        ret.labels = [labels for _ in range(len(data))]
    ret.data = data
    return ret


def recursive_apply(obj, fn, *args, **kwargs):
    """Recursively applies a function to an obj
    Parameters
    ----------
    obj : string, tuple, list, or dict
        Object (leaves must be strings, regardless of type)
    fn : function
        function to be applied to the leaves (strings)
    Returns
    -------
    string, tuple, list, or dict
        Object of the same type as obj, with fn applied to leaves
    """
    if type(obj) in [str, bytes]:
        return fn(obj, *args, **kwargs)#obj.format(**(mapping))
    elif type(obj) == tuple:
        return tuple(recursive_apply(list(obj), fn, *args, **kwargs))
    elif type(obj) == list:
        return [recursive_apply(o, fn, *args, **kwargs) for o in obj]
    elif type(obj) == dict:
        return {k: recursive_apply(v, fn, *args, **kwargs) for k, v in obj.items()}
    else:
        return fn(obj, *args, **kwargs)
        # return obj



def recursive_format(obj, mapping, ignore_missing=False):
    """Formats all strings within an object, using mapping
    Parameters
    ----------
    obj : string, tuple, list, or dict
        Object (leaves must be strings, regardless of type)
    mapping : dict
        format dictionary, maps keys to values
    ignore_missing : bool
        If True, will not throw exception if a string contains a tag not
        present in mapping, and will keep the tag instead.
    Returns
    -------
    string, tuple, list, or dict
        Object of the same type as obj, with strings formatted (tags replaced
        by their value)
    """
    def formatfn(x, mapping):
        fmt = SafeFormatter()
        formatz = lambda x, m: x.format(**m) if not ignore_missing else fmt.format(x, **m)
        options = re.compile(r'{([^}]+):([^}]+)}')
        def mysub(match):
            options, thing = match.group(1, 2)
            ret = ''
            if 'a' in options:
                if ignore_missing and thing not in mapping:
                    return match.group()
                else:
                    word = formatz('{%s}' % thing, mapping)
                    ret += '%s ' % add_article(word).split()[0]
            ret += '{%s}' % thing
            return ret
        x = options.sub(mysub, x)
        return formatz(x, mapping)
    return recursive_apply(obj, formatfn, mapping)



class MunchWithAdd(munch.Munch):
    def __add__(self, other):
        temp = copy.deepcopy(self)
        for k in self:
            try:
                temp[k] = temp[k] + other[k]
            except KeyError:
                raise Exception('Both Munches must have the same keys')
        return temp

    def __iadd__(self, other):
        for k in self:
            self[k] = self[k] + other[k]
        return self