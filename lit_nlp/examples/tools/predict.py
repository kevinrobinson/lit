import numpy as np
import tensorflow as tf
import pandas as pd
import transformers
from lit_nlp.examples.models import pretrained_lms


# df = pd.read_csv('/Users/kevinrobinson/Documents/datasets/Equity-Evaluation-Corpus/Equity-Evaluation-Corpus.csv')
# tokenizer = transformers.AutoTokenizer.from_pretrained('bert-base-uncased')
text = 'allows us to hope that nolan is poised to embark a major career as a commercial yet inventive filmmaker .'


# model = pretrained_lms.BertMLM(model_name, top_k=10)
# inputs = [{
# 	'data': {
# 		'label': 1,
# 		'text': text
# 	},
# 	'id': '',
# 	'meta': {}
# }]
# preds = list(model.predict_with_metadata(inputs))
# print(preds)


model_name = 'bert-base-uncased'
tokenizer = transformers.AutoTokenizer.from_pretrained(model_name)
model = transformers.TFBertForMaskedLM.from_pretrained(model_name, output_hidden_states=True, output_attentions=True)


tokenized_texts = tokenizer.tokenize(text)
encoded_input = tokenizer.batch_encode_plus(
    tokenized_texts,
    is_pretokenized=True,
    return_tensors="tf",
    add_special_tokens=True,
    max_length=model.config.max_position_embeddings,
    pad_to_max_length=True)

logits, embs, unused_attentions = model(encoded_input)
print(logits)
print(embs)
print(unused_attentions)
print('-------')
batched_outputs = {
    "probas": tf.nn.softmax(logits, axis=-1).numpy(),
    "input_ids": encoded_input["input_ids"].numpy(),
    "ntok": tf.reduce_sum(encoded_input["attention_mask"], axis=1).numpy(),
    "cls_emb": embs[-1][:, 0].numpy(),  # last layer, first token
}    
print(batched_outputs)


# vocab = {}
# print(len(df))
# for index, row in df.iterrows():
# 	tokens = tokenizer.tokenize(row['Person'])
# 	for token in tokens:
# 		vocab[token] = [row['Person'], row['Gender'], row['Race']]

# for key in sorted(vocab.keys()):
# 	print(key, vocab[key])


# # 8640
# # ##a ['Latoya', 'female', 'African-American']
# # ##el ['Jamel', 'male', 'African-American']
# # ##ha ['Lakisha', 'female', 'African-American']
# # ##iq ['Shaniqua', 'female', 'African-American']
# # ##isha ['Tanisha', 'female', 'African-American']
# # ##kis ['Lakisha', 'female', 'African-American']
# # ##lle ['Nichelle', 'female', 'African-American']
# # ##nce ['Terrence', 'male', 'African-American']
# # ##nell ['Darnell', 'male', 'African-American']
# # ##onzo ['Alonzo', 'male', 'African-American']
# # ##phon ['Alphonse', 'male', 'African-American']
# # ##rance ['Torrance', 'male', 'African-American']
# # ##reen ['Shereen', 'female', 'African-American']
# # ##se ['Alphonse', 'male', 'African-American']
# # ##tish ['Latisha', 'female', 'African-American']
# # ##toy ['Latoya', 'female', 'African-American']
# # ##ua ['Shaniqua', 'female', 'African-American']
# # adam ['Adam', 'male', 'European']
# # al ['Alphonse', 'male', 'African-American']
# # alan ['Alan', 'male', 'European']
# # amanda ['Amanda', 'female', 'European']
# # andrew ['Andrew', 'male', 'European']
# # aunt ['my aunt', 'female', nan]
# # betsy ['Betsy', 'female', 'European']
# # boy ['this boy', 'male', nan]
# # boyfriend ['my boyfriend', 'male', nan]
# # brother ['my brother', 'male', nan]
# # courtney ['Courtney', 'female', 'European']
# # dad ['my dad', 'male', nan]
# # dar ['Darnell', 'male', 'African-American']
# # daughter ['my daughter', 'female', nan]
# # ebony ['Ebony', 'female', 'African-American']
# # ellen ['Ellen', 'female', 'European']
# # father ['my father', 'male', nan]
# # frank ['Frank', 'male', 'European']
# # girl ['this girl', 'female', nan]
# # girlfriend ['my girlfriend', 'female', nan]
# # harry ['Harry', 'male', 'European']
# # he ['he', 'male', nan]
# # heather ['Heather', 'female', 'European']
# # her ['her', 'female', nan]
# # him ['him', 'male', nan]
# # husband ['my husband', 'male', nan]
# # jack ['Jack', 'male', 'European']
# # jam ['Jamel', 'male', 'African-American']
# # jasmine ['Jasmine', 'female', 'African-American']
# # jerome ['Jerome', 'male', 'African-American']
# # josh ['Josh', 'male', 'European']
# # justin ['Justin', 'male', 'European']
# # katie ['Katie', 'female', 'European']
# # kristin ['Kristin', 'female', 'European']
# # la ['Latoya', 'female', 'African-American']
# # lamar ['Lamar', 'male', 'African-American']
# # leroy ['Leroy', 'male', 'African-American']
# # malik ['Malik', 'male', 'African-American']
# # man ['this man', 'male', nan]
# # melanie ['Melanie', 'female', 'European']
# # mom ['my mom', 'female', nan]
# # mother ['my mother', 'female', nan]
# # my ['my mom', 'female', nan]
# # nancy ['Nancy', 'female', 'European']
# # niche ['Nichelle', 'female', 'African-American']
# # roger ['Roger', 'male', 'European']
# # ryan ['Ryan', 'male', 'European']
# # shan ['Shaniqua', 'female', 'African-American']
# # she ['Shereen', 'female', 'African-American']
# # sister ['my sister', 'female', nan]
# # son ['my son', 'male', nan]
# # stephanie ['Stephanie', 'female', 'European']
# # tan ['Tanisha', 'female', 'African-American']
# # terre ['Terrence', 'male', 'African-American']
# # this ['this girl', 'female', nan]
# # tia ['Tia', 'female', 'African-American']
# # tor ['Torrance', 'male', 'African-American']
# # uncle ['my uncle', 'male', nan]
# # wife ['my wife', 'female', nan]
# # woman ['this woman', 'female', nan]