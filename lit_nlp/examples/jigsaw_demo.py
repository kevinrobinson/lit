# Lint as: python3
r"""Quick-start demo for a model that flags comments for review.

This demo fine-tunes a small Transformer (BERT-tiny) on the Jigsaw Unintended Bias
in Toxicity Classification Challenge, and starts a LIT server.

To run locally:
  python -m lit_nlp.examples.jigsaw_demo \
      --port=5432

Training should take less than 5 minutes on a single GPU. Once you see the
ASCII-art LIT logo, navigate to localhost:5432 to access the demo UI.
"""
import tempfile

from absl import app
from absl import flags
from absl import logging

from lit_nlp import dev_server
from lit_nlp import server_flags
from lit_nlp.examples.datasets import jigsaw
from lit_nlp.examples.models import jigsaw_models

# NOTE: additional flags defined in server_flags.py

FLAGS = flags.FLAGS

flags.DEFINE_string(
    "encoder_name", "google/bert_uncased_L-2_H-128_A-2",
    "Encoder name to use for fine-tuning. See https://huggingface.co/models.")

flags.DEFINE_string("model_path", None, "Path to save trained model.")


def run_finetuning(train_path):
  """Fine-tune a transformer model."""
  logging.info('run:test...')
  test_data = jigsaw.UnintendedBiasInToxicityClassificationData("test")

  logging.info('run:validation...')
  val_data = jigsaw.UnintendedBiasInToxicityClassificationData("validation")
  
  # logging.info('run:train...')
  # train_data = jigsaw.UnintendedBiasInToxicityClassificationData("train")
  
  logging.info('run:done.')
  model = jigsaw_models.ToxicityClassifierModel(FLAGS.encoder_name, for_training=True)
  model.train(test_data.examples, validation_inputs=val_data.examples)
  model.save(train_path)


def main(_):
  model_path = FLAGS.model_path or tempfile.mkdtemp()
  logging.info("Working directory: %s", model_path)
  if model_path is None:
    run_finetuning(model_path)

  limit = 1000

  # Load our trained model.
  models = {
    "toxicity_TEST": jigsaw_models.ToxicityClassifierModel(model_path)
  }
  datasets = {
    "toxicity_val_1000": jigsaw.UnintendedBiasInToxicityClassificationData("validation").sample(limit),
    "toxicity_test_1000": jigsaw.UnintendedBiasInToxicityClassificationData("test").sample(limit),
  }

  # Start the LIT server. See server_flags.py for server options.
  lit_demo = dev_server.Server(models, datasets, **server_flags.get_flags())
  lit_demo.serve()


if __name__ == "__main__":
  app.run(main)
