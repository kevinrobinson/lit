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
"""Tests for lit_nlp.generators.word_replacer."""

from absl.testing import absltest

from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import types as lit_types
from lit_nlp.components import checklist_perturber
from lit_nlp.lib import testing_utils


class ChecklistPerturberTest(absltest.TestCase):
    def _generate(self, input_text, rule_key):
        input_spec = {'text': lit_types.TextSegment()}
        dataset = lit_dataset.Dataset(input_spec, {'text': 'blank'})
        model = testing_utils.TestRegressionModel(input_spec)
        generator = checklist_perturber.Generator()

        input_dict = {'text': input_text}
        config_dict = {'rule_key': rule_key}
        examples = generator.generate(input_dict, model, dataset, config=config_dict)
        return list(ex['text'] for ex in examples)

    def test_add_negation(self):
        self.assertEqual(
            self._generate('this test is passing', 'add_negation'),
            ['this test is not passing'])
        self.assertEqual(
            self._generate('Python is awesome.', 'add_negation'),
            ['Python is not awesome.'])
        self.assertEqual(
            self._generate('Python is awesome and TypeScript is too.', 'add_negation'),
            ['Python is not awesome and TypeScript is too.'])
        self.assertEqual(
            self._generate('this is cool', 'add_negation'),
            ['this is not cool'])
        self.assertEqual(
            self._generate('this is not cool', 'add_negation'),
            [])

    def test_change_names_front(self):
        perturbations = self._generate('Sarah says hello', 'change_names')
        self.assertEqual(9 <= len(perturbations) <= 10, True)
        for perturbation in perturbations:
            words = perturbation.split(' ')
            self.assertNotEqual(words[0], 'Sarah')
            self.assertEqual(' '.join(words[1:]), 'says hello')

    def test_change_names_multiple(self):
        perturbations = self._generate('Sarah says hello to Greg', 'change_names')
        self.assertEqual(9 <= len(perturbations) <= 10, True)
        for perturbation in perturbations:
            words = perturbation.split(' ')
            self.assertNotEqual(words[0], 'Sarah')
            self.assertNotEqual(words[-1], 'Greg')
            self.assertEqual(' '.join(words[1:-1]), 'says hello to')

    # showing how the library bakes in sociocultural perspectives
    def test_change_names_multiple(self):
        perturbations = self._generate('Ayodele says hello to Tyreek', 'change_names')
        self.assertEqual(len(perturbations), 0)


    # see https://github.com/marcotcr/checklist/pull/43
    def test_add_negation_bug_workaround(self):
        self.assertEqual(
            self._generate('they know their audience', 'add_negation'),
            []) 

if __name__ == '__main__':
  absltest.main()
