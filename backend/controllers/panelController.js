const adminPanel = {
  header: {
    badge: "Admin control tower",
    title: "Transport management system admin panel",
    description:
      "Manage fleet, drivers, routes, billing, and live truck movement from one admin workspace."
  },
  highlights: [
    "Admins get a consolidated view of dispatch, compliance, finance, and live tracking.",
    "Driver approvals, trip planning, and truck availability are visible in one control layer.",
    "Logout-ready role sessions and focused admin modules are now wired into the panel."
  ],
  stats: [
    {
      label: "Fleet available",
      value: "62",
      description: "Live count of trucks, trailers, and standby units ready for dispatch.",
      change: "8 under maintenance",
      tone: "success"
    },
    {
      label: "Drivers ready",
      value: "41",
      description: "Document-verified drivers cleared for today's assignments.",
      change: "5 awaiting compliance review",
      tone: "warning"
    },
    {
      label: "Trips in motion",
      value: "27",
      description: "Count of shipments in planning, loading, and active movement.",
      change: "4 routes need approval",
      tone: "neutral"
    },
    {
      label: "Receivables at risk",
      value: "£64,000",
      description: "Overdue or near-due customer invoices requiring finance follow-up.",
      change: "3 escalations today",
      tone: "danger"
    }
  ],
  modules: [
    {
      title: "Driver Management",
      description: "Driver onboarding, document expiry, shift readiness, and trip allocation approvals."
    },
    {
      title: "Finance Management",
      description: "Collections follow-up, vendor payouts, cash flow view, and overdue control."
    },
    {
      title: "Trip / Route Planning",
      description: "Lane planning, dispatch scheduling, dock windows, and vehicle assignment."
    },
    {
      title: "Invoicing & Billing",
      description: "Freight invoice generation, POD-linked billing, and payment status tracking."
    },
    {
      title: "GPS / Live Tracking",
      description: "Current location, speed, ETA, and last ping visibility for every active truck."
    },
    {
      title: "Control Room Alerts",
      description: "Delay, breakdown, compliance breach, and reassignment escalations."
    }
  ],
  driverQueue: [
    {
      name: "Rohit Sharma",
      assignment: "DEL-MUM | Ashok Leyland 3118",
      compliance: "Medical valid, fastag balance low",
      status: "Ready for release",
      tone: "success"
    },
    {
      name: "Imran Khan",
      assignment: "JPR-AHD | Tata 1613",
      compliance: "License valid, PUC renewal in 3 days",
      status: "Renewal follow-up",
      tone: "warning"
    },
    {
      name: "Karan Gill",
      assignment: "LKO-DEL | Eicher Pro 6048",
      compliance: "Rest window breached, backup needed",
      status: "Reassign driver",
      tone: "danger"
    },
    {
      name: "Sandeep Yadav",
      assignment: "PNQ-HYD | BharatBenz 2823",
      compliance: "All documents clear, shift starts 20:00",
      status: "Queued for dispatch",
      tone: "neutral"
    }
  ],
  tripPlans: [
    {
      route: "DEL-MUM-204",
      vehicle: "MH12AB1024",
      schedule: "Dock out 18:30 · ETA 07:15",
      status: "Loading complete",
      tone: "success"
    },
    {
      route: "JPR-AHD-118",
      vehicle: "RJ14GF2281",
      schedule: "Route audit pending toll cost approval",
      status: "Planner review",
      tone: "warning"
    },
    {
      route: "LKO-DEL-091",
      vehicle: "UP32QT4110",
      schedule: "Driver replacement and slot rebooking required",
      status: "Blocked",
      tone: "danger"
    },
    {
      route: "BLR-CHN-233",
      vehicle: "KA51TR8820",
      schedule: "Night dispatch scheduled at 22:45",
      status: "Ready to assign",
      tone: "neutral"
    }
  ],
  finance: [
    {
      invoice: "INV-4821",
      client: "Northline Retail",
      amount: "£5,800.00",
      due: "Due in 2 days · POD verified",
      status: "Ready to collect",
      tone: "warning"
    },
    {
      invoice: "INV-4796",
      client: "Apex Electronics",
      amount: "£11,200.00",
      due: "Overdue by 4 days · escalation sent",
      status: "Escalated",
      tone: "danger"
    },
    {
      invoice: "INV-4762",
      client: "Metro Foods",
      amount: "£7,650.00",
      due: "Paid today · receipt posted",
      status: "Settled",
      tone: "success"
    },
    {
      invoice: "INV-4840",
      client: "Eastern Pharma",
      amount: "£9,240.00",
      due: "Billing hold · waiting POD scan",
      status: "On hold",
      tone: "neutral"
    }
  ],
  trackingBoard: [
    {
      truck: "MH12AB1024",
      driver: "Rohit Sharma",
      location: "Nashik bypass, KM 184",
      eta: "07:15 AM",
      status: "Running on plan",
      note: "58 km/h · last ping 2 min ago",
      tone: "success"
    },
    {
      truck: "RJ14GF2281",
      driver: "Imran Khan",
      location: "Udaipur fuel halt",
      eta: "07:40 PM",
      status: "Stopped at waypoint",
      note: "Fuel + tyre inspection · last ping 5 min ago",
      tone: "warning"
    },
    {
      truck: "UP32QT4110",
      driver: "Karan Gill",
      location: "Kanpur outer ring",
      eta: "08:10 AM",
      status: "Delay risk",
      note: "Driver rest exception · last ping 9 min ago",
      tone: "danger"
    }
  ],
  alerts: [
    {
      title: "Insurance renewals due",
      description: "Insurance for 3 fleet units expires in the next 72 hours; release blocks may apply.",
      tone: "danger"
    },
    {
      title: "Driver document queue",
      description: "Medical, permit, or badge approvals for 5 drivers are waiting for admin review.",
      tone: "warning"
    },
    {
      title: "Lane utilization spike",
      description: "Ahmedabad and Mumbai corridors are running above 90% utilization; extra truck planning is required.",
      tone: "success"
    }
  ]
};

const driverPanel = {
  header: {
    badge: "Driver Panel",
    title: "Daily route and compliance desk",
    description:
      "Assigned trip, document readiness, stop updates, and dispatcher notices in one focused panel."
  },
  highlights: [
    "The driver workspace is optimized for trip execution and daily task flow.",
    "Trip progress, documents, and daily support are available in one route view.",
    "Admin-dispatch sync stays maintained on the same domain."
  ],
  stats: [
    {
      label: "Trips today",
      value: "2",
      description: "Scheduled delivery runs assigned for the current shift window.",
      change: "1 active now",
      tone: "warning"
    },
    {
      label: "Hours driven",
      value: "5.4h",
      description: "Current day logged driving duration from start of shift.",
      change: "Within limit",
      tone: "success"
    },
    {
      label: "Pending docs",
      value: "1",
      description: "Items that still need upload or admin verification.",
      change: "PUC expires soon",
      tone: "danger"
    },
    {
      label: "Fuel efficiency",
      value: "8.9 km/l",
      description: "Latest rolling average calculated from active trip logs.",
      change: "+0.6 vs last week",
      tone: "neutral"
    }
  ],
  todayTrip: {
    route: "Jaipur -> Ahmedabad",
    vehicle: "RJ14GF2281 | Tata 1613",
    dispatcher: "Amit Verma",
    departure: "05:30 AM",
    eta: "07:40 PM",
    load: "Electronics - 12 pallets, dock unload at Narol Hub.",
    status: "On schedule",
    tone: "success"
  },
  checklist: [
    {
      title: "Driving License",
      expiry: "Valid till 12 Dec 2026",
      status: "Verified",
      tone: "success"
    },
    {
      title: "Fitness Certificate",
      expiry: "Valid till 04 Sep 2026",
      status: "Verified",
      tone: "success"
    },
    {
      title: "PUC Certificate",
      expiry: "Renews in 5 days",
      status: "Renew soon",
      tone: "warning"
    }
  ],
  stops: [
    {
      title: "Jaipur warehouse departure",
      time: "05:30 AM",
      note: "Loading closed and gate pass acknowledged.",
      tone: "success"
    },
    {
      title: "Udaipur fuel halt",
      time: "11:45 AM",
      note: "Approved fuel voucher and 20-minute inspection stop.",
      tone: "warning"
    },
    {
      title: "Ahmedabad Narol hub arrival",
      time: "07:40 PM",
      note: "Dock team notified for unload window.",
      tone: "neutral"
    }
  ],
  notices: [
    {
      title: "Dispatcher update",
      description: "Narol hub unload gate changed from Bay 4 to Bay 2.",
      tone: "warning"
    },
    {
      title: "Support note",
      description: "Tyre inspection photo upload is required before return trip approval.",
      tone: "danger"
    },
    {
      title: "Trip assistance",
      description: "Control room contact is pre-filled for SOS and route diversion requests.",
      tone: "success"
    }
  ],
  payouts: [
    {
      label: "Current week",
      value: "£1,840.00",
      description: "Completed trip earnings queued for this payroll cycle.",
      change: "Settlement Friday",
      tone: "success"
    },
    {
      label: "Trip allowance",
      value: "£235.00",
      description: "Food, halt and trip-linked operational reimbursements.",
      change: "Auto-claimed",
      tone: "neutral"
    },
    {
      label: "Penalty watch",
      value: "£0.00",
      description: "No late check-in or document penalties on current logs.",
      change: "Clear record",
      tone: "success"
    }
  ]
};

function getAdminPanel(_req, res) {
  res.json(adminPanel);
}

function getDriverPanel(_req, res) {
  res.json(driverPanel);
}

module.exports = { getAdminPanel, getDriverPanel };
