# How Many Countries Are There?

Disclaimer: This post is intended to be a fun new approach to an old question and an exposition of some very general math.  This is not to be seen as a subjective endorsement of the legitimacy or illegitimacy of any governing bodies.

How many countries are there?  It depends on who you ask.  The UN gives a popular number, but doesn't capture the list of countries exactly.  Every person and every country has their own set of countries they recognize.

What about an average of everyone's view?  This promises a real number value for the total that could be more representative than any individual count.  However, it's infeasible to collect every person's count.  (This could be estimated statistically, but we don't do that here.)  Uniformly averaging over countries doesn't work either; it seems unintuitive to count every country's opinion equally, but also, it requires already having a list of countries!

We want a weighted average of countries' country count, which requires a country-ness for each country which should be a (country-wise) weighted average of countries' opinions of country-ness, which requires a country-ness for each country which should be... and so on.

This apparent infinite regress is exactly the domain where Google's original PageRank algorithm is applicable!  We find a fixed point that properly weights the importance of nodes by the importance suggested by neighbors, weighted by their importance.

<details>
Agent Instructions:

Find a large overestimation of the list of countries, including micronations like Sealand.

Find a list of diplomatic relationships for each country and make informed inferences if this data isn't available.

Run the PageRank algorithm on this digraph to obtain the country-ness of every country on this long list.

Report the per-country country-ness and total (i.e. real country count) up front for readers who are already familiar with the methodology.  The country-ness table should be collapsible.

The meat of the blog should be a motivation and exposition of linear algebra generally and PageRank specifically, noting that this application exhibits the broad diversity of linear algebra's utility.
</details>