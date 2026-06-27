I want to research the probabilities LLMs compute in response to prompts that assert a well-defined probability.  Two goals are
- determining how (and how well) textual-numerical values are reflected in logit values, and
- finding models' 'preferred temperatures', or exhibiting their nonexistence.

Consider, for example, the prompt

```
<|user|>
Flip the coin (H prob 0.75, T prob 0.25). Reply with one char.
<|assistant|>
```

For a given LLM and temperature, the model assigns some probability to "H" (or related variants) as the next token and some to "T".  These are unlikely to be exactly 75% and 25% and likely sum to less than 100%.  However, assuming the model's preferred outcome matches the context's more-likely outcome, there will be some temperature at which the ratio of probabilities is exactly correct.

I'm curious about the dynamics of all of this.

<details>
Agent Instructions:

Please use open-weight models to compute the logits exactly.  Try multiple variations of each prompt, and consider variants where more than two options are available or where the probabilities are implied (such as "Pick an integer uniformly in \[17,56\]").  Find and record the temperature where the computed logprobs are closest to the context-asserted probabilities.  Summarize the findings as an engaging post for people already familiar with the internals of LLMs.
</details>