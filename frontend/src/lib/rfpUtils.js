import React from "react";

export const LEAD_TYPES = [
  "MQL",
  "HQL",
  "BANT - DIGITAL",
  "BANT - TELE",
  "BANT +",
  "APPOINTMENT SET-UP",
];

export const buildClientIds = () => {
  const ids = [];
  for (let i = 1; i <= 100; i++) {
    ids.push(`EVCL${String(i).padStart(3, "0")}`);
  }
  return ids;
};

export const emptyRFP = () => ({
  section1: {
    rfp_master_tracking_sheet: "",
    date_of_rfp: "",
    campaign_run_date: { start_date: "", end_date: "" },
    client_id: "",
    campaign_name: "",
    campaign_id: "",
    end_client_name: "",
    target_geography: [],
    target_industries: [],
    revenue_size: [],
    employee_size: [],
    target_job_functions: [],
    target_job_titles: [],
    target_job_seniority: [],
    contacts_per_company: 1,
    exclusions: "",
    suppression_file: "",
    campaign_type_config: { types: [], num_qq: 0, num_cq: 0, num_touches: 0, with_tv: false },
  },
  section2: { data_universe: 0 },
  section3: {
    data_source: "",
    rows: LEAD_TYPES.map((lt) => ({
      lead_type: lt, cpl: 0, lead_counts: 0, total_cost: 0,
    })),
    grand_total_leads: 0,
    grand_total_cost: 0,
    blended_cpl: 0,
  },
  section4: {
    rfp_submitted_date: "",
    rfp_converted: "N",
    volumes_assigned: 0,
  },
});

export const fmtNum = (n, dec = 0) => {
  if (n === null || n === undefined || isNaN(Number(n))) return "0";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
};

export const fmtCurrency = (n) =>
  `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const useDebounce = (value, delay = 350) => {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};
