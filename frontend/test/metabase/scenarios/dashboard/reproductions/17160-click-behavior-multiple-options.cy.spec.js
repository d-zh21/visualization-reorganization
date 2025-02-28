import { restore, popover, visitDashboard } from "__support__/e2e/cypress";

import { SAMPLE_DATABASE } from "__support__/e2e/cypress_sample_database";

const { PRODUCTS, PRODUCTS_ID } = SAMPLE_DATABASE;

const TARGET_DASHBOARD_NAME = "Target dashboard";
const CATEGORY_FILTER_PARAMETER_ID = "7c9ege62";

describe("issue 17160", () => {
  beforeEach(() => {
    restore();
    cy.signInAsAdmin();
  });

  it("should pass multiple filter values to questions and dashboards (metabase#17160-1)", () => {
    setup(false);
    cy.findByText("Category").click();

    popover().within(() => {
      cy.findByText("Doohickey").click();
      cy.findByText("Gadget").click();

      cy.button("Add filter").click();
    });

    // Check click behavior connected to a question
    cy.findAllByText("click-behavior-question-label")
      .eq(0)
      .click();

    cy.url().should("include", "/question");

    assertMultipleValuesFilterState();

    // Go back to the dashboard
    cy.go("back");

    // Check click behavior connected to a dashboard
    cy.findAllByText("click-behavior-dashboard-label")
      .eq(0)
      .click();

    cy.url().should("include", "/dashboard");
    cy.findByText(TARGET_DASHBOARD_NAME);

    assertMultipleValuesFilterState();
  });

  it("should pass multiple filter values to public questions and dashboards (metabase#17160-2)", () => {
    setup(true);

    cy.icon("share").click();

    // Open the dashboard public link
    cy.findByText("Public link")
      .parent()
      .within(() => {
        cy.get("input").then(input => {
          cy.visit(input.val());
        });
      });

    cy.findByText("Category").click();

    popover().within(() => {
      cy.findByText("Doohickey").click();
      cy.findByText("Gadget").click();

      cy.button("Add filter").click();
    });

    // Check click behavior connected to a question
    cy.findAllByText("click-behavior-question-label")
      .eq(0)
      .click();

    cy.url().should("include", "/public/question");

    assertMultipleValuesFilterState();

    // Go back to the dashboard
    cy.go("back");

    // Check click behavior connected to a dashboard
    cy.findAllByText("click-behavior-dashboard-label")
      .eq(0)
      .click();

    cy.url().should("include", "/public/dashboard");
    cy.findByText(TARGET_DASHBOARD_NAME);

    assertMultipleValuesFilterState();
  });
});

function assertMultipleValuesFilterState() {
  cy.findByText("2 selections").click();

  cy.findByTestId("Doohickey-filter-value").within(() =>
    cy.get("input").should("be.checked"),
  );
  cy.findByTestId("Gadget-filter-value").within(() =>
    cy.get("input").should("be.checked"),
  );
}

function setup(shouldUsePublicLinks) {
  cy.createNativeQuestion({
    name: `17160Q`,
    native: {
      query: "SELECT * FROM products WHERE {{CATEGORY}}",
      "template-tags": {
        CATEGORY: {
          id: "6b8b10ef-0104-1047-1e1b-2492d5954322",
          name: "CATEGORY",
          display_name: "CATEGORY",
          type: "dimension",
          dimension: ["field", PRODUCTS.CATEGORY, null],
          "widget-type": "category",
          default: null,
        },
      },
    },
  }).then(({ body: { id: questionId } }) => {
    // Share the question
    cy.request("POST", `/api/card/${questionId}/public_link`);

    cy.createDashboard({ name: "17160D" }).then(
      ({ body: { id: dashboardId } }) => {
        // Share the dashboard
        cy.request("POST", `/api/dashboard/${dashboardId}/public_link`);

        // Add the question to the dashboard
        cy.request("POST", `/api/dashboard/${dashboardId}/cards`, {
          cardId: questionId,
        }).then(({ body: { id: dashCardId } }) => {
          // Add dashboard filter
          cy.request("PUT", `/api/dashboard/${dashboardId}`, {
            parameters: [
              {
                id: CATEGORY_FILTER_PARAMETER_ID,
                name: "Category",
                slug: "category",
                sectionId: "string",
                type: "string/=",
              },
            ],
          });

          createTargetDashboardForClickBehavior().then(targetDashboardId => {
            // Create a click behavior and resize the question card
            cy.request("PUT", `/api/dashboard/${dashboardId}/cards`, {
              cards: [
                {
                  id: dashCardId,
                  card_id: questionId,
                  row: 0,
                  col: 0,
                  sizeX: 12,
                  sizeY: 10,
                  parameter_mappings: [
                    {
                      parameter_id: CATEGORY_FILTER_PARAMETER_ID,
                      card_id: 4,
                      target: ["dimension", ["template-tag", "CATEGORY"]],
                    },
                  ],
                  visualization_settings: getVisualSettingsWithClickBehavior(
                    questionId,
                    targetDashboardId,
                    shouldUsePublicLinks,
                  ),
                },
              ],
            });

            visitDashboard(dashboardId);
          });
        });
      },
    );
  });
}

function getVisualSettingsWithClickBehavior(
  questionTarget,
  dashboardTarget,
  shouldUsePublicLinks = false,
) {
  return {
    column_settings: {
      '["name","ID"]': {
        click_behavior: {
          use_public_link: shouldUsePublicLinks,
          targetId: questionTarget,
          parameterMapping: {
            "6b8b10ef-0104-1047-1e1b-2492d5954322": {
              source: {
                type: "parameter",
                id: CATEGORY_FILTER_PARAMETER_ID,
                name: "Category",
              },
              target: {
                type: "variable",
                id: "CATEGORY",
              },
              id: "6b8b10ef-0104-1047-1e1b-2492d5954322",
            },
          },
          linkType: "question",
          type: "link",
          linkTextTemplate: "click-behavior-question-label",
        },
      },

      '["name","EAN"]': {
        click_behavior: {
          use_public_link: shouldUsePublicLinks,
          targetId: dashboardTarget,
          parameterMapping: {
            dd19ec03: {
              source: {
                type: "parameter",
                id: CATEGORY_FILTER_PARAMETER_ID,
                name: "Category",
              },
              target: {
                type: "parameter",
                id: "dd19ec03",
              },
              id: "dd19ec03",
            },
          },
          linkType: "dashboard",
          type: "link",
          linkTextTemplate: "click-behavior-dashboard-label",
        },
      },
    },
  };
}

function createTargetDashboardForClickBehavior() {
  return cy
    .createQuestionAndDashboard({
      dashboardDetails: {
        name: TARGET_DASHBOARD_NAME,
      },
      questionDetails: {
        query: {
          "source-table": PRODUCTS_ID,
        },
      },
    })
    .then(({ body: { id, card_id, dashboard_id } }) => {
      // Share the dashboard
      cy.request("POST", `/api/dashboard/${dashboard_id}/public_link`);

      // Add a filter
      cy.request("PUT", `/api/dashboard/${dashboard_id}`, {
        parameters: [
          {
            name: "Category",
            slug: "category",
            id: "dd19ec03",
            type: "string/=",
            sectionId: "string",
          },
        ],
      });

      // Create a click behavior and resize the question card
      return cy
        .request("PUT", `/api/dashboard/${dashboard_id}/cards`, {
          cards: [
            {
              id,
              card_id,
              row: 0,
              col: 0,
              sizeX: 12,
              sizeY: 10,
              parameter_mappings: [
                {
                  parameter_id: "dd19ec03",
                  card_id,
                  target: ["dimension", ["field", PRODUCTS.CATEGORY, null]],
                },
              ],
            },
          ],
        })
        .then(() => {
          return dashboard_id;
        });
    });
}
