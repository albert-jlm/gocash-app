
UPDATE gocash.transactions
SET status       = 'confirmed',
    confirmed_at = COALESCE(confirmed_at, NOW()),
    updated_at   = NOW()
WHERE status = 'awaiting_confirm';
