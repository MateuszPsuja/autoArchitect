import type { RefinementQuestion } from './refinement.schema';

export const REFINE_MORE_QUESTION_ID = '__refine_more__';

export const REFINE_MORE_QUESTION: RefinementQuestion = {
  id: REFINE_MORE_QUESTION_ID,
  question: 'Do you want more questions to refine it further?',
  type: 'single_choice',
  options: [
    'Yes, ask more questions',
    'No, generate the plan with these answers',
  ],
};

export const REFINE_MORE_MAX_ROUNDS = 3;
