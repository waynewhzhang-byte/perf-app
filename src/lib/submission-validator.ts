import { z } from 'zod';

export { parseDateOnly, computeItemScore } from '@/lib/submission-score';

export const UpsertSchema = z.object({
  templateId: z.string(),
  workAreaId: z.string().optional(),
  hireDate: z.string().optional(),
  declarationLevelId: z.string().optional(),
  declarationSpecialtyId: z.string().optional(),
  items: z.array(z.object({
    itemId: z.string(),
    selected: z.array(z.object({
      index: z.number(),
      optionId: z.string().optional(),
      label: z.string().optional(),
      score: z.number().optional(),
      count: z.number().int().min(0).optional(),
    })),
    content: z.string().optional(),
    declaredScore: z.number().finite().optional(),
    confirmationStatus: z.enum(['CONFIRMED', 'DISPUTED']).nullable().optional(),
    disputeReason: z.string().nullable().optional(),
    isSystemFilled: z.boolean().optional(),
  })),
  submit: z.boolean().default(false),
});
