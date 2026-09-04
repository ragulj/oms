# Order Processing System

This take home assessment is pretty open ended, so my first step was to set clear technical and business boundaries. Throughout this assignment, I will compare how I would handle this in a real world production environment versus a scoped assessment.

## AI and Workflow

I have been using a custom agent kit for SDD along with Claude for the last few months, but that repository is private and company owned. For the current complexity of this assignment, I am plainly relying on the proven open source `spec-kit` from GitHub without any customizations.

In a real scenario, I would clarify the nature of the business, edge cases, and technical context as `SKILLS`. I would also bake language specific best practices into the agent module to help automate things. To accommodate the time constraints of this test, I am just relying on just in time prompts to guide the AI.

## Tech Stack

I am going with Node.js and the NestJS framework. I agree that for a take home assessment, NestJS is not exactly lightweight and usually requires a lot of boilerplate. However, since I am relying on AI for the setup, the usual cons and setup time are essentially eliminated.

I chose Node without any rigid criteria. In the real world, picking a stack requires assessing multiple factors like driver availability, ORM support, third party integrations, and the existing ecosystem. For this specific assessment, we just do not have enough data to mandate one over the other. Furthermore, in the post AI era, the learning curve for jumping into any of these stacks is drastically reduced.

## Living Document

This README will act as a living document. As development progresses, I will log all architectural tradeoffs, out-of-scope decisions, and any specific challenges faced while using the AI spec-kit right here.
