// STATUS & ENUMS (provisional — akan diselaraskan dengan spec 01-PRODUCT.md)
export const ServiceStatus = {
  REQUEST: { DRAFT: 'draft', SUBMITTED: 'submitted' },
  OFFER: { DRAFT: 'draft', PENDING_APPROVAL: 'pending_approval', APPROVED: 'approved', REJECTED: 'rejected' },
  ASSIGN: { PENDING: 'pending', ASSIGNED: 'assigned', IN_PROGRESS: 'in_progress' },
  COMPLETE: { PENDING: 'pending', DONE: 'done', ISSUE: 'issue' },
  LEDGER: { PENDING: 'pending', POSTED: 'posted' },
  REPORT: { DRAFT: 'draft', FINAL: 'final' },
}

// SCHEMA REFERENSI (DDL dibuat via management.md, bukan dari app)
/*
requests:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  customer_name TEXT NOT NULL
  service_type TEXT NOT NULL
  location TEXT
  description TEXT
  status TEXT NOT NULL DEFAULT 'draft'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

offers:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  request_id BIGINT NOT NULL REFERENCES requests(id)
  ai_proposal_json JSONB
  validated_price NUMERIC
  validated_scope TEXT
  status TEXT NOT NULL DEFAULT 'draft'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

assignments:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  offer_id BIGINT NOT NULL REFERENCES offers(id)
  worker_name TEXT
  scheduled_at TIMESTAMPTZ
  status TEXT NOT NULL DEFAULT 'pending'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

completions:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  assignment_id BIGINT NOT NULL REFERENCES assignments(id)
  notes TEXT
  photos_path TEXT[]
  status TEXT NOT NULL DEFAULT 'pending'
  completed_at TIMESTAMPTZ
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

ledger_entries:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  completion_id BIGINT NOT NULL REFERENCES completions(id)
  amount NUMERIC NOT NULL
  category TEXT NOT NULL
  status TEXT NOT NULL DEFAULT 'pending'
  posted_at TIMESTAMPTZ
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

reports:
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
  owner_id TEXT NOT NULL DEFAULT auth.uid()
  period_start DATE NOT NULL
  period_end DATE NOT NULL
  summary_json JSONB
  explanation_html TEXT
  status TEXT NOT NULL DEFAULT 'draft'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
*/

export function createRequest(input) {
  return {
    customer_name: input.customer_name?.trim() ?? '',
    service_type: input.service_type?.trim() ?? '',
    location: input.location?.trim() ?? '',
    description: input.description?.trim() ?? '',
    status: ServiceStatus.REQUEST.DRAFT,
  }
}

export function createOffer(requestId, aiProposal, validatedPrice, validatedScope) {
  return {
    request_id: requestId,
    ai_proposal_json: aiProposal,
    validated_price: validatedPrice,
    validated_scope: validatedScope,
    status: ServiceStatus.OFFER.DRAFT,
  }
}
