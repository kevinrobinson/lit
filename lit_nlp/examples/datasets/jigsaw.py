# Lint as: python3
"""GLUE benchmark datasets, using TFDS.

See https://gluebenchmark.com/ and
https://www.tensorflow.org/datasets/catalog/glue

Note that this requires the TensorFlow Datasets package, but the resulting LIT
datasets just contain regular Python/NumPy data.
"""
from lit_nlp.api import dataset as lit_dataset
from lit_nlp.api import types as lit_types


class UnintendedBiasInToxicityClassificationData(lit_dataset.Dataset):
  """Jigsaw Unintended Bias in Toxicity Classification

  See
  https://www.tensorflow.org/datasets/catalog/civil_comments
  """
  def __init__(self, split: str):
    self._examples = []

    for ex in lit_dataset.load_tfds('civil_comments/CivilCommentsIdentities', split=split, do_sort=False):
      self._examples.append({
          'sentence': ex['text'].decode('utf-8'),
          'label': ex['toxicity'],
      })

  def spec(self):
    return {
        'sentence': lit_types.TextSegment(),
        'label': lit_types.RegressionScore()
    }
