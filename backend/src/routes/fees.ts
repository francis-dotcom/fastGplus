import { Router } from 'express';

const router = Router();

const FEES = [
  {
    key:               'tuition',
    label:             'Tuition Fees (Fall 2024)',
    base_label:        'Base Tuition',
    base_amount:       4200,
    processing_fee:    25.50,
    installment_count: 3,
    sort_order:        10,
  },
  {
    key:               'tech',
    label:             'Technology & Resource Fee',
    base_label:        'Technology & Resource Fee',
    base_amount:       150,
    processing_fee:    2.50,
    installment_count: 0,
    sort_order:        20,
  },
  {
    key:               'application',
    label:             'Application Fee',
    base_label:        'Application Fee',
    base_amount:       75,
    processing_fee:    2.50,
    installment_count: 0,
    sort_order:        30,
  },
  {
    key:               'library',
    label:             'Library Fines / Misc',
    base_label:        'Library / Misc',
    base_amount:       0,
    processing_fee:    0,
    installment_count: 0,
    sort_order:        40,
  },
];

router.get('/', (_req, res) => {
  res.json({ fees: FEES });
});

export default router;
