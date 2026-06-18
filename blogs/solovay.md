# Provably Unprovably ... Unprovably Unprovable

When I first learned about Godel's First Incompleteness Theorem, probably in early undergrad, I was fascinated by the idea of a provably unprovable and irrefutable claim.  This claim is true or false in the 'real world' ($\Th(\mathbb{N})$), so there is a true claim we cannot prove.

But I wondered if we could raise this a level.  Is there a claim (about the natural numbers) that is true, but we can't prove it, but we can't prove that we can't prove it, but we can't prove we can't prove that we can't prove it, and so on?

Luckily, since then I've gotten a degree in proof theory.  If you ask any expert, the answer is clear, and almost obvious, that for any finite number of iterations, there is some statement which is "true, but unprovable, but ...(inside PA)", but there is no single statement with this property at all levels.  From the outside it's surprising that it's even possible to know this!  However, the reasoning is unsatisfying.

But there is a satisfying and visual explanation, if we take a (very natural) detour through modal logic.  If all we care about is provability, the provability logic of PA is well-studied and a good place to look.  We can construct propositional modal formulas corresponding to each iteration of the "unprovably unprovably ... unprovable".  That is, we have reduced the existence of a first-order arithmetic formula with this property to the satisfiability of a modal propositional formula.

However, it's even better!  Solovay showed that provability logic for PA is equivalent to Godel-Lob logic.  Segerberg had already shown that Godel-Lob logic had finite trees as a natural Kripke semantics.  Since our modal formulas of interest have only one propositional variable, this means that the existence of our arithmetical statements with iterated unprovability boils down to finding a family of finite 2-colored trees with a certain property.

You can find these black/white colored trees relatively easily, especially because the formulas of interest boil down to large conjunctions of alternating boxes and diamonds.

I want a blog post that
- motivates the original iterated unprovability problem in Peano Arithmetic,
- introduces modal logic with necessity/possibility, which naturally
- motivates Kripke semantics,
- shows, as an example, how doxastic logic gives another useful interpretation of box,
- shows how provability can be interpreted as a kind of modal logic,
- shows what the iterated unprovability claim is modally, and how it reduces,
- introduces Lob's theorem for PA,
- shows how Lob's theorem is induction for Kripke frames (i.e. implies finiteness) and
- jokingly shows how Lob's theorem is humility in doxastic logic,
- then introduces the axiomatization of Godel-Lob,
- asserts with some proof sketch Segerberg's theorem,
- asserts Solovay's theorem,
- describes the search for candidate trees,
- shows the trees that give existence at finite levels, and
- explains why no finite tree can give iterated unprovability at all levels.

This should be accessible to an early math undergrad and ideally a bright high schooler.
