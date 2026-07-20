const { config } = require("../lib/config");
const { modules } = require("./registry");

function response(description = "OK") {
  return {
    description,
    content: {
      "application/json": {
        schema: { type: "object" }
      }
    }
  };
}

function auth() {
  return [{ bearerAuth: [] }, { apiKeyAuth: [] }];
}

function operation(summary, method = "get", secured = true) {
  return {
    summary,
    security: secured ? auth() : [],
    responses: {
      200: response(method === "post" ? "Created or updated" : "OK"),
      400: response("Bad request"),
      401: response("Unauthorized"),
      403: response("Forbidden")
    }
  };
}

function tenantParameter() {
  return { name: "tenantId", in: "path", required: true, schema: { type: "string" } };
}

function apiKeyParameter() {
  return { name: "keyId", in: "path", required: true, schema: { type: "string" } };
}

function jsonBody(schema) {
  return {
    required: false,
    content: {
      "application/json": { schema }
    }
  };
}

function apiKeyPayloadSchema(required = ["label", "scopes"]) {
  return {
    type: "object",
    required,
    properties: {
      label: { type: "string", example: "ERP productie key" },
      scopes: {
        type: "array",
        items: { type: "string", enum: ["read", "write", "planning", "workorders", "billing", "integrations"] },
        example: ["read", "planning", "workorders", "integrations"],
        description: "Minstens read of write plus minstens een module-scope: planning, workorders, billing of integrations."
      },
      expiresAt: { type: "string", format: "date-time", nullable: true, example: "2026-12-31T23:00:00.000Z", description: "Optioneel. Als dit ontbreekt krijgt de key automatisch 90 dagen geldigheid." }
    }
  };
}

function integrationParameter() {
  return { name: "integrationId", in: "path", required: true, schema: { type: "string" } };
}

function fieldMappingSchema() {
  return {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      required: ["local", "remote"],
      properties: {
        local: { type: "string", example: "workorders.title" },
        remote: { type: "string", example: "project.name" },
        direction: { type: "string", enum: ["push", "pull", "both"], example: "push" }
      }
    }
  };
}

function integrationConnectSchema() {
  return {
    type: "object",
    required: ["provider", "label"],
    properties: {
      provider: { type: "string", enum: ["robaws", "exact", "generic"], example: "robaws" },
      label: { type: "string", example: "Robaws productie" },
      environment: { type: "string", example: "production" },
      baseUrl: { type: "string", example: "https://api.partner.be" },
      apiKey: { type: "string", description: "Wordt versleuteld opgeslagen en nooit opnieuw getoond." },
      fieldMapping: fieldMappingSchema()
    }
  };
}

function supportTicketCreateSchema() {
  return {
    type: "object",
    required: ["title", "description"],
    properties: {
      title: { type: "string", example: "Foto upload traag op werf" },
      category: { type: "string", enum: ["question", "bug", "onboarding", "billing"], example: "bug" },
      priority: { type: "string", enum: ["low", "normal", "high"], example: "high" },
      description: { type: "string", example: "Upload blijft hangen op 4G." }
    }
  };
}

function supportTicketUpdateSchema() {
  return {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "waiting", "closed"], example: "closed" },
      priority: { type: "string", enum: ["low", "normal", "high"], example: "high" },
      comment: { type: "string", example: "Opgelost en bevestigd door klant." }
    }
  };
}

function subscriptionCheckoutSchema() {
  return {
    type: "object",
    required: ["plan"],
    properties: {
      plan: {
        type: "string",
        enum: ["starter", "business", "enterprise"],
        example: "business",
        description: "Target bundle. Enterprise/custom bundles return 400 because they require an assisted contract."
      }
    }
  };
}

function hostedBillingResponseSchema() {
  return {
    type: "object",
    properties: {
      ok: { type: "boolean", example: true },
      provider: { type: "string", enum: ["stripe", "mock"], example: "stripe" },
      url: { type: "string", format: "uri", example: "https://checkout.stripe.com/c/session-id" }
    }
  };
}

function pushSubscriptionSchema() {
  return {
    type: "object",
    required: ["endpoint", "keys"],
    properties: {
      endpoint: { type: "string", format: "uri", example: "https://fcm.googleapis.com/fcm/send/abc" },
      expirationTime: { type: "integer", nullable: true },
      keys: {
        type: "object",
        required: ["p256dh", "auth"],
        properties: {
          p256dh: { type: "string", example: "BNc...publicKey" },
          auth: { type: "string", example: "authSecret" }
        }
      }
    }
  };
}

function customerStartResponseSchema() {
  return {
    type: "object",
    properties: {
      generatedAt: { type: "string", format: "date-time" },
      tenant: {
        type: "object",
        properties: {
          id: { type: "string", example: "t_demo" },
          name: { type: "string", example: "Demo Bouw BV" },
          plan: { type: "string", example: "business" },
          status: { type: "string", example: "trial" }
        }
      },
      activation: {
        type: "object",
        properties: {
          percent: { type: "integer", example: 78 },
          doneSteps: { type: "integer", example: 7 },
          totalSteps: { type: "integer", example: 9 },
          currentPhase: { type: "string", example: "core_operations" },
          readyForPilot: { type: "boolean", example: false },
          readyForProduction: { type: "boolean", example: false }
        }
      },
      nextAction: {
        type: "object",
        properties: {
          label: { type: "string", example: "Open werkbonnen" },
          view: { type: "string", example: "workorders" },
          detail: { type: "string", example: "Maak of controleer de eerste werkbon." }
        }
      },
      workspace: {
        type: "object",
        properties: {
          date: { type: "string", format: "date", example: "2026-05-12" },
          liveStatus: {
            type: "object",
            description: "Customer-facing readiness for the daily operational flow.",
            properties: {
              ready: { type: "boolean", example: true },
              label: { type: "string", example: "Dagelijkse flow klaar" },
              detail: { type: "string", example: "Planning en werkbonnen zijn aanwezig." },
              blockers: {
                type: "array",
                items: { type: "string" },
                example: []
              }
            }
          },
          metrics: {
            type: "array",
            items: { type: "object" }
          },
          priorityActions: {
            type: "array",
            items: { type: "object" }
          }
        }
      },
      sections: {
        type: "array",
        items: { type: "object" }
      }
    }
  };
}

function customerStartBootstrapSchema() {
  return {
    type: "object",
    properties: {
      date: { type: "string", format: "date", example: "2026-06-18" },
      targetWorkorders: { type: "integer", minimum: 1, example: 10 },
      readyBefore: { type: "boolean", example: false },
      fieldUser: {
        type: "object",
        nullable: true,
        properties: {
          id: { type: "string", example: "u_emp1" },
          name: { type: "string", example: "Jan Janssen" },
          role: { type: "string", example: "employee" }
        }
      },
      existing: {
        type: "object",
        properties: {
          venues: { type: "integer", example: 0 },
          customers: { type: "integer", example: 0 },
          dayShifts: { type: "integer", example: 0 },
          openWorkorders: { type: "integer", example: 0 }
        }
      },
      blockers: { type: "array", items: { type: "string" } },
      planned: { type: "array", items: { type: "object" } },
      created: { type: "array", items: { type: "object" } }
    }
  };
}

function ticketParameter() {
  return { name: "ticketId", in: "path", required: true, schema: { type: "string" } };
}

function modulePaths() {
  return modules.reduce((paths, mod) => {
    if (mod.key === "audit") return paths;
    paths[`/api/modules/${mod.key}`] = {
      get: operation(`List ${mod.label}`),
      post: operation(`Create ${mod.label}`, "post")
    };
    paths[`/api/modules/${mod.key}/{id}`] = {
      patch: operation(`Update ${mod.label}`, "post"),
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }]
    };
    return paths;
  }, {});
}

function openApiSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "Monargo One API",
      version: config.appVersion,
      description: "Tenant-scoped SaaS API voor planning, werkbonnen, tijdregistratie, billing, integraties en pilot/commercial launch flows."
    },
    servers: [{ url: config.appUrl }],
    components: {
      schemas: {
        // Formeel gepubliceerde vorm van GET /projects/:id/finance
        // (frontend-coverage punt 2): `actual.total` en `invoiced.total` zijn
        // de CANONIEKE totalen; losse aliassen als actualCost/invoicedAmount
        // zijn compatibiliteitsvarianten en verdwijnen op termijn.
        ProjectFinance: {
          type: "object",
          required: ["projectId", "budget", "actual", "invoiced"],
          properties: {
            projectId: { type: "string" },
            number: { type: "string" },
            financialStatus: { type: "string", example: "open" },
            budget: { type: "number", description: "Budget in euro (incl. goedgekeurde change orders)" },
            actual: {
              type: "object",
              required: ["total"],
              properties: {
                total: { type: "number", description: "CANONIEK werkelijk-totaal in euro" },
                labor: { type: "object", properties: { hours: { type: "number" }, rate: { type: "number" }, cost: { type: "number" }, basis: { type: "string", example: "rate_estimate" }, sourceCount: { type: "integer" } } },
                material: { type: "object", properties: { cost: { type: "number" }, sources: { type: "array", items: { type: "object" } } } },
                expenses: { type: "object", properties: { cost: { type: "number" }, sourceCount: { type: "integer" } } },
              },
            },
            invoiced: {
              type: "object",
              required: ["total"],
              properties: {
                total: { type: "number", description: "CANONIEK gefactureerd-totaal (excl. btw, creditnota's negatief)" },
                paid: { type: "number" },
                sourceCount: { type: "integer" },
                sources: { type: "array", items: { type: "object" } },
              },
            },
            commitment: { type: "object", properties: { total: { type: "number", description: "Openstaande inkoopverplichting" }, sourceCount: { type: "integer" }, sources: { type: "array", items: { type: "object" } } } },
            forecastCost: { type: "number", description: "actual.total + commitment.total" },
            margin: { type: "number", description: "invoiced.total - actual.total (euro)" },
            budgetRemaining: { type: "number" },
            forecastBudgetRemaining: { type: "number" },
            generatedAt: { type: "string", format: "date-time" },
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Interactive admin/session token returned by /api/auth/login. Required for admin-only actions such as backups, support consent, API key management and readiness report generation."
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "Tenant server-to-server key. GET requests require read/module scopes; writes also require the write scope. Tokens are hashed and only shown once."
        }
      }
    },
    paths: {
      "/api/health": { get: operation("Health check", "get", false) },
      "/api/status": {
        get: {
          ...operation("Public status", "get", false),
          description: "Publieke status zonder tenantdata: release, storage, migraties, readiness score en rate-limit policies voor externe monitoring."
        }
      },
      "/api/auth/login": { post: operation("Login and optional MFA challenge", "post", false) },
      "/api/me": { get: operation("Current user") },
      "/api/me/mfa/setup": { post: operation("Start MFA setup", "post") },
      "/api/me/mfa/verify": { post: operation("Verify MFA setup", "post") },
      "/api/modules": { get: operation("List module registry") },
      ...modulePaths(),
      "/api/kbo/lookup": { post: operation("Lookup KBO company", "post") },
      "/api/exports/{module}.csv": {
        get: {
          ...operation("Export module CSV"),
          parameters: [{ name: "module", in: "path", required: true, schema: { type: "string" } }]
        }
      },
      "/api/tenants/{tenantId}/projects/{projectId}/finance": {
        get: {
          ...operation("Project finance read-model"),
          description: "Herleidbaar budget/werkelijk/gefactureerd/verplichting-overzicht per project. Alleen beheerders (403 FINANCIAL_SCOPE). Vorm: components.schemas.ProjectFinance · actual.total en invoiced.total zijn de canonieke totalen.",
          responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, finance: { $ref: "#/components/schemas/ProjectFinance" } } } } } } },
        },
      },
      "/api/tenants/{tenantId}/golden-path": { get: operation("Golden path readiness") },
      "/api/tenants/{tenantId}/golden-path/demo": { post: operation("Create demo golden path", "post") },
      "/api/tenants/{tenantId}/customer-start": {
        get: {
          ...operation("Customer activation start"),
          parameters: [tenantParameter()],
          description: "Returns a customer-facing activation checklist with next action, grouped steps, live readiness and progress for getting a tenant live quickly.",
          responses: {
            200: {
              description: "Customer start payload",
              content: {
                "application/json": {
                  schema: customerStartResponseSchema()
                }
              }
            },
            401: response("Unauthorized"),
            403: response("Forbidden")
          }
        }
      },
      "/api/tenants/{tenantId}/customer-start/bootstrap": {
        get: {
          ...operation("Preview customer-start bootstrap"),
          parameters: [
            tenantParameter(),
            { name: "date", in: "query", required: false, schema: { type: "string", format: "date" } },
            { name: "targetWorkorders", in: "query", required: false, schema: { type: "integer", default: 1, minimum: 1 } }
          ],
          description: "Dry-run for the first operational customer day. Shows which tenant-scoped records would be created without writing data.",
          responses: {
            200: {
              description: "Customer-start bootstrap preview",
              content: { "application/json": { schema: customerStartBootstrapSchema() } }
            },
            401: response("Unauthorized"),
            403: response("Forbidden")
          }
        },
        post: {
          ...operation("Apply customer-start bootstrap", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody({
            type: "object",
            properties: {
              date: { type: "string", format: "date", example: "2026-06-18" },
              targetWorkorders: { type: "integer", minimum: 1, default: 1, example: 10 }
            }
          }),
          description: "Creates the missing first-day venue, customer, planning item and open workorders. Requires interactive user permissions for planning and workorders; writes an audit event.",
          responses: {
            201: {
              description: "Customer-start bootstrap applied",
              content: { "application/json": { schema: customerStartBootstrapSchema() } }
            },
            400: response("Bad request"),
            401: response("Unauthorized"),
            403: response("Forbidden")
          }
        }
      },
      "/api/tenants/{tenantId}/suggestions/home": {
        get: {
          ...operation("Homepage AI suggestion"),
          parameters: [tenantParameter()],
          description: "Returns the next best in-app action for the current tenant and user. Admin users may receive production or pilot suggestions; field users receive operational suggestions."
        }
      },
      "/api/tenants/{tenantId}/suggestions/home/events": {
        post: {
          ...operation("Track homepage AI suggestion interaction", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody({
            type: "object",
            properties: {
              key: { type: "string", example: "production_blockers" },
              event: { type: "string", enum: ["primary", "secondary", "dismissed"], example: "primary" },
              source: { type: "string", example: "go_live" },
              priority: { type: "string", example: "P0" }
            }
          }),
          description: "Writes a tenant-scoped audit event for suggestion clicks, making in-app AI advice measurable without storing extra recommendation records."
        }
      },
      "/api/tenants/{tenantId}/admin/status": { get: operation("Tenant admin status") },
      "/api/tenants/{tenantId}/admin/users/{userId}/unlock": { post: operation("Unlock user account", "post") },
      "/api/tenants/{tenantId}/admin/backups": {
        get: {
          ...operation("List tenant backups"),
          parameters: [tenantParameter()],
          description: "Lists only backups belonging to this tenant. Requires interactive admin login."
        },
        post: {
          ...operation("Create tenant-scoped backup", "post"),
          parameters: [tenantParameter()],
          description: "Creates a tenant-scoped backup containing only tenant-bound records, not the full platform store."
        }
      },
      "/api/tenants/{tenantId}/admin/backups/{backupId}/preview": {
        get: {
          ...operation("Preview tenant backup"),
          parameters: [tenantParameter(), { name: "backupId", in: "path", required: true, schema: { type: "string" } }],
          description: "Previews current versus backup counts after verifying the backup belongs to the tenant."
        }
      },
      "/api/tenants/{tenantId}/admin/backups/{backupId}/restore": {
        post: {
          ...operation("Restore tenant backup", "post"),
          parameters: [tenantParameter(), { name: "backupId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: jsonBody({ type: "object", required: ["confirm"], properties: { confirm: { type: "string", enum: ["RESTORE"] } } }),
          description: "Restores only tenant-bound rows from a tenant-owned backup. Requires confirm=RESTORE and interactive admin login."
        }
      },
      "/api/tenants/{tenantId}/api-keys": {
        get: { ...operation("List tenant API keys"), parameters: [tenantParameter()] },
        post: {
          ...operation("Create tenant API key", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody(apiKeyPayloadSchema())
        }
      },
      "/api/tenants/{tenantId}/api-keys/governance": {
        get: {
          ...operation("API key governance gate"),
          parameters: [
            tenantParameter(),
            { name: "strict", in: "query", required: false, schema: { type: "boolean", default: false } }
          ],
          description: "Returns P0/P1 governance issues for tenant API keys, including expired keys, missing scopes, missing expiry, unused keys and repeated denials."
        }
      },
      "/api/tenants/{tenantId}/api-keys/governance/run": {
        post: {
          ...operation("Run and audit API key governance gate", "post"),
          parameters: [tenantParameter()],
          description: "Runs the strict API-key governance gate and writes an audit event without changing keys."
        }
      },
      "/api/tenants/{tenantId}/api-keys/{keyId}/rotate": {
        post: {
          ...operation("Rotate tenant API key", "post"),
          parameters: [tenantParameter(), apiKeyParameter()],
          requestBody: jsonBody(apiKeyPayloadSchema([])),
          description: "Rotates a key, revokes the old token and optionally replaces label, scopes and expiresAt. When expiresAt is omitted the new key defaults to 90 days."
        }
      },
      "/api/tenants/{tenantId}/api-keys/{keyId}/revoke": {
        post: {
          ...operation("Revoke tenant API key", "post"),
          parameters: [tenantParameter(), apiKeyParameter()]
        }
      },
      "/api/tenants/{tenantId}/portal": { get: operation("Customer portal payload") },
      "/api/tenants/{tenantId}/pilot/kpis": {
        get: {
          ...operation("Pilot KPIs"),
          description: "Returns pilot KPIs with value, target, ok and action so customer success can turn open KPIs into onboarding tasks."
        }
      },
      "/api/tenants/{tenantId}/pilot/decision-report": {
        post: {
          ...operation("Generate pilot decision report", "post"),
          description: "Generates a pilot decision report with goNoGo.decision, open risks and action list."
        }
      },
      "/api/tenants/{tenantId}/support-tickets": {
        get: {
          ...operation("List support tickets with SLA metadata"),
          parameters: [tenantParameter()],
          description: "Returns tenant support tickets with sla.deadlineAt, sla.remainingHours, sla.breached, sla.status and escalation.level for pilot blockers."
        },
        post: {
          ...operation("Create support ticket", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody(supportTicketCreateSchema())
        }
      },
      "/api/tenants/{tenantId}/support-tickets/{ticketId}": {
        patch: {
          ...operation("Update support ticket and audit SLA closure", "post"),
          parameters: [tenantParameter(), ticketParameter()],
          requestBody: jsonBody(supportTicketUpdateSchema())
        }
      },
      "/api/tenants/{tenantId}/billing/setup-intent": { post: operation("Create Stripe SetupIntent", "post") },
      "/api/tenants/{tenantId}/billing/checkout": {
        post: {
          ...operation("Create Stripe subscription checkout", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody(subscriptionCheckoutSchema()),
          description: "Starts a hosted Stripe Checkout session for recurring subscription billing. Requires an interactive billing-capable user. In local/mock mode it returns a mock URL and immediately marks the tenant plan active; in live mode the subscription state is finalized by the Stripe webhook.",
          responses: {
            200: {
              description: "Hosted checkout URL",
              content: { "application/json": { schema: hostedBillingResponseSchema() } }
            },
            400: response("Unknown, inactive or assisted-only plan"),
            401: response("Unauthorized"),
            403: response("Forbidden")
          }
        }
      },
      "/api/tenants/{tenantId}/billing/portal": {
        post: {
          ...operation("Create Stripe billing portal session", "post"),
          parameters: [tenantParameter()],
          description: "Creates a hosted Stripe Billing Portal session for payment method, upgrade/downgrade and cancellation self-service. Requires an interactive billing-capable user.",
          responses: {
            200: {
              description: "Hosted billing portal URL",
              content: { "application/json": { schema: hostedBillingResponseSchema() } }
            },
            401: response("Unauthorized"),
            403: response("Forbidden")
          }
        }
      },
      "/api/tenants/{tenantId}/billing/summary": { get: operation("Billing summary") },
      "/api/tenants/{tenantId}/billing/quote": { get: operation("Billing quote") },
      "/api/tenants/{tenantId}/billing/contract-state": { post: operation("Transition contract state", "post") },
      "/api/tenants/{tenantId}/billing/payment-method": { post: operation("Attach tokenized payment method", "post") },
      "/api/tenants/{tenantId}/billing/invoices": { post: operation("Create invoice", "post") },
      "/api/tenants/{tenantId}/billing/peppol/{invoiceId}": { post: operation("Send invoice via Peppol", "post") },
      "/api/tenants/{tenantId}/billing/payment-failed": { post: operation("Register failed payment", "post") },
      "/api/webhooks/stripe": { post: operation("Stripe webhook", "post", false) },
      "/api/tenants/{tenantId}/mobile/today": { get: operation("Mobile today payload") },
      "/api/tenants/{tenantId}/mobile/sync": { post: operation("Sync mobile offline queue", "post") },
      "/api/tenants/{tenantId}/mobile/workorders/{workorderId}/complete": { post: operation("Complete mobile workorder", "post") },
      "/api/tenants/{tenantId}/mobile/workorders/{workorderId}/photo": { post: operation("Attach mobile workorder photo", "post") },
      "/api/tenants/{tenantId}/mobile/workorders/{workorderId}/signature": { post: operation("Sign mobile workorder", "post") },
      "/api/tenants/{tenantId}/me/push/key": {
        get: {
          ...operation("Get web-push VAPID public key"),
          parameters: [tenantParameter()],
          description: "Returns whether browser push is configured and the public VAPID key needed by the PWA client. The private key is never exposed."
        }
      },
      "/api/tenants/{tenantId}/me/push/subscribe": {
        post: {
          ...operation("Register this device for web-push", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody({
            type: "object",
            properties: {
              subscription: pushSubscriptionSchema()
            },
            additionalProperties: true
          }),
          description: "Stores a user-scoped browser PushSubscription for the authenticated user. Requires endpoint plus p256dh/auth keys and deduplicates by endpoint."
        }
      },
      "/api/tenants/{tenantId}/me/push/unsubscribe": {
        post: {
          ...operation("Remove this device web-push subscription", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody({
            type: "object",
            required: ["endpoint"],
            properties: { endpoint: { type: "string", format: "uri" } }
          }),
          description: "Removes a user-scoped browser PushSubscription endpoint from the authenticated user."
        }
      },
      "/api/tenants/{tenantId}/integrations": {
        get: { ...operation("List integrations with syncSummary and mappingSummary"), parameters: [tenantParameter()] }
      },
      "/api/tenants/{tenantId}/integrations/connect": {
        post: {
          ...operation("Connect integration", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody(integrationConnectSchema())
        }
      },
      "/api/tenants/{tenantId}/integrations/{integrationId}/mapping": {
        post: {
          ...operation("Update integration field mapping", "post"),
          parameters: [tenantParameter(), integrationParameter()],
          requestBody: jsonBody({ type: "object", required: ["fieldMapping"], properties: { fieldMapping: fieldMappingSchema() } })
        }
      },
      "/api/tenants/{tenantId}/integrations/{integrationId}/sync": {
        post: { ...operation("Run integration sync", "post"), parameters: [tenantParameter(), integrationParameter()] }
      },
      "/api/tenants/{tenantId}/integrations/{integrationId}/retry": {
        post: {
          ...operation("Retry integration sync log", "post"),
          parameters: [tenantParameter(), integrationParameter()],
          requestBody: jsonBody({ type: "object", required: ["syncId"], properties: { syncId: { type: "string" } } })
        }
      },
      "/api/tenants/{tenantId}/notifications": {
        get: {
          ...operation("List notifications"),
          description: "Returns tenant notifications, including sourceRef for idempotent support escalation reminders."
        },
        post: operation("Create notification", "post")
      },
      "/api/tenants/{tenantId}/notifications/reminders": {
        post: {
          ...operation("Generate reminders", "post"),
          description: "Creates planning, workorder, billing and support escalation reminders. Support reminders are de-duplicated by sourceRef."
        }
      },
      "/api/tenants/{tenantId}/sales/summary": { get: operation("Sales launch KPI summary") },
      "/api/tenants/{tenantId}/sales/readiness": {
        get: {
          ...operation("Commercial launch readiness"),
          description: "Returns commercial launch checks with targets, values and actions for qualified leads, demos, paid customers, activation, trial-to-paid and churn."
        }
      },
      "/api/tenants/{tenantId}/go-live": {
        get: {
          ...operation("Combined go-live readiness"),
          description: "Returns combined production, pilot and commercial launch gates for dashboards and external status automation."
        }
      },
      "/api/tenants/{tenantId}/roadmap": {
        get: {
          ...operation("Roadmap phase status"),
          parameters: [tenantParameter()],
          description: "Returns the five roadmap phases with score, go/no-go status and open actions derived from production, golden path, pilot and commercial launch gates."
        }
      },
      "/api/tenants/{tenantId}/reports": {
        get: {
          ...operation("List generated readiness reports"),
          parameters: [
            tenantParameter(),
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 20 } }
          ],
          description: "Lists generated pilot, commercial launch, go-live and status-bundle artifacts for the tenant without exposing local file contents."
        }
      },
      "/api/tenants/{tenantId}/reports/generate": {
        post: {
          ...operation("Generate tenant readiness report bundle", "post"),
          parameters: [tenantParameter()],
          requestBody: jsonBody({
            type: "object",
            properties: {
              minPilotScore: { type: "integer", default: 80 },
              strictProduction: { type: "boolean", default: false }
            }
          }),
          description: "Generates pilot, commercial launch, go-live, roadmap and status-bundle artifacts through the same gate logic used by the Admin UI."
        }
      },
      "/api/tenants/{tenantId}/reports/{reportId}": {
        get: {
          ...operation("Preview generated readiness report"),
          parameters: [
            tenantParameter(),
            { name: "reportId", in: "path", required: true, schema: { type: "string" } }
          ],
          description: "Returns a small inline JSON or Markdown readiness report preview after tenant-prefix and path traversal checks."
        }
      },
      "/api/audit": {
        get: {
          ...operation("Audit log"),
          parameters: [
            { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
            { name: "area", in: "query", required: false, schema: { type: "string" } },
            { name: "action", in: "query", required: false, schema: { type: "string" } },
            { name: "actor", in: "query", required: false, schema: { type: "string" } },
            { name: "since", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 500 } },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv"], default: "json" } }
          ],
          description: "Returns tenant-safe audit events with optional filters for area, action, actor, since and limit. Use format=csv for export. Non-super admins are always restricted to their own tenant."
        }
      },
      "/api/errors": {
        get: {
          ...operation("Error event log"),
          parameters: [
            { name: "tenantId", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "integer" } },
            { name: "method", in: "query", required: false, schema: { type: "string" } },
            { name: "path", in: "query", required: false, schema: { type: "string" } },
            { name: "message", in: "query", required: false, schema: { type: "string" } },
            { name: "since", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 500 } },
            { name: "format", in: "query", required: false, schema: { type: "string", enum: ["json", "csv"], default: "json" } }
          ],
          description: "Returns tenant-safe error events without stack traces. Supports status, method, path, message, since, limit and CSV export filters."
        }
      }
    }
  };
}

module.exports = { openApiSpec };
