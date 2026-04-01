// client/src/components/MBRDesigner/mbrDemoData.js
// Demo data matching the Metformin HCl 500mg from uploaded mbr.js
// Shapes match the MBRDesigner.jsx state: mbr, phases[].steps[].parameters[], bom[], signatures[]

const cid = () => crypto.randomUUID();

export const DEMO_MBR = {
  id: 'b1000000-0000-0000-0000-000000000001',
  mbr_code: 'MBR-MET-500-001',
  product_name: 'Metformin HCl 500mg Tablets',
  product_code: 'PROD-MET-500',
  dosage_form: 'Tablet',
  batch_size: 200000,
  batch_size_unit: 'tablets',
  description: 'Master Batch Record for Metformin Hydrochloride 500mg film-coated tablets. Wet granulation process with high-shear granulator, V-blender, rotary tablet press, and perforated pan coater.',
  status: 'Draft',
  current_version: 1,
  target_yield: 97,
};

export const DEMO_PHASES = [
  {
    id: 'ph-001', phase_number: 1, phase_name: 'Dispensing', description: 'Weigh and dispense all raw materials per BOM', sort_order: 1,
    steps: [
      {
        id: 'st-001', step_number: 1, step_name: 'Line Clearance', instruction: 'Verify dispensing area is clean. Check for previous product residues. Confirm environmental conditions.',
        step_type: 'Verification', duration_min: 15, is_critical: false, is_gmp_critical: true,
        parameters: [], materials: [], equipment: [], ipc_checks: [],
      },
      {
        id: 'st-002', step_number: 2, step_name: 'API Dispensing', instruction: 'Weigh Metformin HCl API per BOM. Verify identity via CoA barcode scan. Double-weigh verification required.',
        step_type: 'Weighing', duration_min: 30, is_critical: true, is_gmp_critical: true,
        parameters: [],
        materials: [
          { id: cid(), material_code: 'RM-API-001', material_name: 'Metformin HCl API', material_type: 'API', quantity: 100, unit: 'kg', is_active: true },
        ],
        equipment: [
          { id: cid(), equipment_code: 'EQ-BAL-001', equipment_name: 'Precision Balance 150kg', equipment_type: 'Reactor', capacity: '150 kg', is_primary: true },
        ],
        ipc_checks: [
          { id: cid(), check_name: 'Identity Verification', check_type: 'Barcode', specification: 'Matches CoA', frequency: 'Each material' },
          { id: cid(), check_name: 'Weight Verification', check_type: 'Gravimetric', specification: 'Within ±0.5% tolerance', frequency: 'Each material' },
        ],
      },
      {
        id: 'st-003', step_number: 3, step_name: 'Excipient Dispensing', instruction: 'Weigh all excipients per BOM. Verify identity for each material. Record tare, gross, and net weights.',
        step_type: 'Weighing', duration_min: 45, is_critical: false, is_gmp_critical: false,
        parameters: [],
        materials: [
          { id: cid(), material_code: 'RM-EXC-001', material_name: 'Microcrystalline Cellulose', material_type: 'Excipient', quantity: 30, unit: 'kg', is_active: false },
          { id: cid(), material_code: 'RM-EXC-002', material_name: 'Povidone K30', material_type: 'Excipient', quantity: 8, unit: 'kg', is_active: false },
          { id: cid(), material_code: 'RM-EXC-003', material_name: 'Magnesium Stearate', material_type: 'Excipient', quantity: 2, unit: 'kg', is_active: false },
        ],
        equipment: [], ipc_checks: [],
      },
    ],
  },
  {
    id: 'ph-002', phase_number: 2, phase_name: 'Granulation', description: 'Wet granulation using high-shear granulator with PVP K30 binder solution', sort_order: 2,
    steps: [
      {
        id: 'st-004', step_number: 1, step_name: 'Dry Mixing', instruction: 'Load API and intragranular excipients into high-shear granulator. Mix dry for 5 minutes at low impeller speed.',
        step_type: 'Processing', duration_min: 10, is_critical: false, is_gmp_critical: false,
        parameters: [
          { id: cid(), param_name: 'Impeller Speed', param_type: 'numeric', target_value: '100', unit: 'RPM', lower_limit: 80, upper_limit: 120, is_cpp: false, is_cqa: false },
          { id: cid(), param_name: 'Mixing Time', param_type: 'numeric', target_value: '5', unit: 'min', lower_limit: 4, upper_limit: 7, is_cpp: false, is_cqa: false },
        ],
        materials: [], equipment: [
          { id: cid(), equipment_code: 'EQ-GRN-001', equipment_name: 'High-Shear Granulator 300L', equipment_type: 'Granulator', capacity: '300L', is_primary: true },
        ], ipc_checks: [],
      },
      {
        id: 'st-005', step_number: 2, step_name: 'Binder Addition & Wet Massing', instruction: 'Add PVP K30 binder solution at controlled rate while mixing at high impeller speed. Continue wet granulation until endpoint reached.',
        step_type: 'Processing', duration_min: 15, is_critical: true, is_gmp_critical: true,
        parameters: [
          { id: cid(), param_name: 'Impeller Speed', param_type: 'numeric', target_value: '250', unit: 'RPM', lower_limit: 200, upper_limit: 300, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Chopper Speed', param_type: 'numeric', target_value: '1500', unit: 'RPM', lower_limit: 1200, upper_limit: 1800, is_cpp: false, is_cqa: false },
          { id: cid(), param_name: 'Granulation Time', param_type: 'numeric', target_value: '10', unit: 'min', lower_limit: 8, upper_limit: 15, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Binder Addition Rate', param_type: 'numeric', target_value: '200', unit: 'mL/min', lower_limit: 150, upper_limit: 250, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Product Temperature', param_type: 'numeric', target_value: '45', unit: '°C', lower_limit: 35, upper_limit: 55, is_cpp: true, is_cqa: false },
        ],
        materials: [
          { id: cid(), material_code: 'RM-SOL-001', material_name: 'Purified Water', material_type: 'Solvent', quantity: 15, unit: 'L', is_active: false },
        ],
        equipment: [], ipc_checks: [],
      },
      {
        id: 'st-006', step_number: 3, step_name: 'Drying', instruction: 'Transfer wet granules to fluid bed dryer. Dry at 60°C inlet air temperature until LOD reaches 1.5-3.0%.',
        step_type: 'Processing', duration_min: 60, is_critical: true, is_gmp_critical: false,
        parameters: [
          { id: cid(), param_name: 'Inlet Air Temperature', param_type: 'numeric', target_value: '60', unit: '°C', lower_limit: 55, upper_limit: 65, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Product Temperature', param_type: 'numeric', target_value: '40', unit: '°C', lower_limit: 35, upper_limit: 50, is_cpp: true, is_cqa: false },
        ],
        materials: [], equipment: [
          { id: cid(), equipment_code: 'EQ-FBD-001', equipment_name: 'Fluid Bed Dryer', equipment_type: 'FBD', capacity: '500L', is_primary: true },
        ],
        ipc_checks: [
          { id: cid(), check_name: 'Granule Moisture (LOD)', check_type: 'LOD', specification: '1.5-3.0%', frequency: 'End of drying' },
          { id: cid(), check_name: 'Granule Size (d50)', check_type: 'Sieve Analysis', specification: '200-500 µm', frequency: 'End of milling' },
        ],
      },
      {
        id: 'st-007', step_number: 4, step_name: 'Sizing', instruction: 'Pass dried granules through comminuting mill with 1.0mm screen.',
        step_type: 'Processing', duration_min: 20, is_critical: false, is_gmp_critical: false,
        parameters: [], materials: [], equipment: [
          { id: cid(), equipment_code: 'EQ-MIL-001', equipment_name: 'Comminuting Mill', equipment_type: 'Mill', capacity: '—', is_primary: true },
        ], ipc_checks: [],
      },
    ],
  },
  {
    id: 'ph-003', phase_number: 3, phase_name: 'Blending', description: 'Blend dried granules with extragranular excipients in V-blender', sort_order: 3,
    steps: [
      {
        id: 'st-008', step_number: 1, step_name: 'Final Blending', instruction: 'Charge sized granules and extragranular MCC to V-blender. Blend 20 min. Add MgSt, blend 3 min.',
        step_type: 'Processing', duration_min: 25, is_critical: true, is_gmp_critical: false,
        parameters: [
          { id: cid(), param_name: 'Blender Speed', param_type: 'numeric', target_value: '25', unit: 'RPM', lower_limit: 20, upper_limit: 30, is_cpp: false, is_cqa: false },
          { id: cid(), param_name: 'Blending Time', param_type: 'numeric', target_value: '20', unit: 'min', lower_limit: 15, upper_limit: 25, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Lubricant Mixing Time', param_type: 'numeric', target_value: '3', unit: 'min', lower_limit: 2, upper_limit: 5, is_cpp: true, is_cqa: false },
        ],
        materials: [], equipment: [
          { id: cid(), equipment_code: 'EQ-BLD-001', equipment_name: 'V-Blender 500L', equipment_type: 'Blender', capacity: '500L', is_primary: true },
        ],
        ipc_checks: [
          { id: cid(), check_name: 'Blend Uniformity', check_type: 'HPLC', specification: 'RSD ≤ 5%', frequency: '10 locations' },
          { id: cid(), check_name: 'Bulk Density', check_type: 'Tapped', specification: '0.45-0.65 g/mL', frequency: 'End of blending' },
        ],
      },
    ],
  },
  {
    id: 'ph-004', phase_number: 4, phase_name: 'Compression', description: 'Compress blend into tablets using rotary tablet press', sort_order: 4,
    steps: [
      {
        id: 'st-009', step_number: 1, step_name: 'Press Setup', instruction: 'Install 12.5mm round concave tooling. Set compression parameters. Run setup tablets.',
        step_type: 'Processing', duration_min: 30, is_critical: false, is_gmp_critical: false,
        parameters: [], materials: [], equipment: [
          { id: cid(), equipment_code: 'EQ-TAB-001', equipment_name: 'Rotary Tablet Press 45-stn', equipment_type: 'Tablet Press', capacity: '45 stations', is_primary: true },
        ], ipc_checks: [],
      },
      {
        id: 'st-010', step_number: 2, step_name: 'Compression Run', instruction: 'Compress blend at target parameters. Monitor weight, hardness, thickness continuously.',
        step_type: 'Processing', duration_min: 480, is_critical: true, is_gmp_critical: true,
        parameters: [
          { id: cid(), param_name: 'Main Compression Force', param_type: 'numeric', target_value: '25', unit: 'kN', lower_limit: 18, upper_limit: 32, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Pre-compression Force', param_type: 'numeric', target_value: '5', unit: 'kN', lower_limit: 3, upper_limit: 8, is_cpp: false, is_cqa: false },
          { id: cid(), param_name: 'Turret Speed', param_type: 'numeric', target_value: '45', unit: 'RPM', lower_limit: 35, upper_limit: 55, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Fill Depth', param_type: 'numeric', target_value: '12.5', unit: 'mm', lower_limit: 11.5, upper_limit: 13.5, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Tablet Weight', param_type: 'numeric', target_value: '700', unit: 'mg', lower_limit: 665, upper_limit: 735, is_cpp: true, is_cqa: true },
        ],
        materials: [], equipment: [],
        ipc_checks: [
          { id: cid(), check_name: 'Individual Weight', check_type: 'Gravimetric', specification: '665-735 mg', frequency: 'Every 30 min (20 tablets)' },
          { id: cid(), check_name: 'Hardness', check_type: 'Hardness Tester', specification: '5-10 kP', frequency: 'Every 30 min (10 tablets)' },
          { id: cid(), check_name: 'Thickness', check_type: 'Caliper', specification: '5.0-6.0 mm', frequency: 'Every 30 min (10 tablets)' },
          { id: cid(), check_name: 'Friability', check_type: 'Friabilator', specification: 'NMT 1.0%', frequency: 'Every 2 hours' },
          { id: cid(), check_name: 'Disintegration', check_type: 'Disintegration Tester', specification: 'NMT 15 min', frequency: 'Every 2 hours' },
        ],
      },
    ],
  },
  {
    id: 'ph-005', phase_number: 5, phase_name: 'Coating', description: 'Film coat tablets in perforated coating pan with Opadry White', sort_order: 5,
    steps: [
      {
        id: 'st-011', step_number: 1, step_name: 'Film Coating', instruction: 'Charge core tablets to coating pan. Apply Opadry White film coat suspension to 3% weight gain.',
        step_type: 'Processing', duration_min: 180, is_critical: true, is_gmp_critical: false,
        parameters: [
          { id: cid(), param_name: 'Inlet Air Temperature', param_type: 'numeric', target_value: '55', unit: '°C', lower_limit: 50, upper_limit: 60, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Exhaust Temperature', param_type: 'numeric', target_value: '42', unit: '°C', lower_limit: 38, upper_limit: 46, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Spray Rate', param_type: 'numeric', target_value: '50', unit: 'g/min', lower_limit: 35, upper_limit: 65, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Pan Speed', param_type: 'numeric', target_value: '10', unit: 'RPM', lower_limit: 8, upper_limit: 12, is_cpp: false, is_cqa: false },
        ],
        materials: [
          { id: cid(), material_code: 'RM-COT-001', material_name: 'Opadry White (Film Coat)', material_type: 'Excipient', quantity: 6, unit: 'kg', is_active: false },
        ],
        equipment: [
          { id: cid(), equipment_code: 'EQ-COT-001', equipment_name: 'Perforated Coating Pan', equipment_type: 'Coater', capacity: '200kg', is_primary: true },
        ],
        ipc_checks: [
          { id: cid(), check_name: 'Tablet Appearance', check_type: 'Visual', specification: 'Uniform white, no defects', frequency: 'Every 30 min' },
          { id: cid(), check_name: 'Weight Gain', check_type: 'Gravimetric', specification: '3.0 ± 0.5%', frequency: 'End of coating' },
        ],
      },
    ],
  },
  {
    id: 'ph-006', phase_number: 6, phase_name: 'Packaging', description: 'Primary blister packaging and secondary carton packaging', sort_order: 6,
    steps: [
      {
        id: 'st-012', step_number: 1, step_name: 'Blister Packaging', instruction: 'Pack coated tablets into Alu-Alu blisters. Secondary pack into printed cartons.',
        step_type: 'Processing', duration_min: 360, is_critical: false, is_gmp_critical: false,
        parameters: [
          { id: cid(), param_name: 'Sealing Temperature', param_type: 'numeric', target_value: '180', unit: '°C', lower_limit: 170, upper_limit: 190, is_cpp: true, is_cqa: false },
          { id: cid(), param_name: 'Machine Speed', param_type: 'numeric', target_value: '120', unit: 'blisters/min', lower_limit: 100, upper_limit: 150, is_cpp: false, is_cqa: false },
        ],
        materials: [
          { id: cid(), material_code: 'PM-BLS-001', material_name: 'Alu-Alu Blister Foil', material_type: 'Packaging', quantity: 50, unit: 'rolls', is_active: false },
          { id: cid(), material_code: 'PM-CTN-001', material_name: 'Cartons (printed)', material_type: 'Packaging', quantity: 20000, unit: 'pcs', is_active: false },
        ],
        equipment: [
          { id: cid(), equipment_code: 'EQ-PKG-001', equipment_name: 'Blister Packaging Line', equipment_type: 'Reactor', capacity: '—', is_primary: true },
        ],
        ipc_checks: [
          { id: cid(), check_name: 'Seal Integrity', check_type: 'Vacuum', specification: 'No leaks at -0.5 bar', frequency: 'Every 30 min' },
          { id: cid(), check_name: 'Print Verification', check_type: 'Vision', specification: 'Batch/Exp correct', frequency: 'Start + every hour' },
          { id: cid(), check_name: 'Tablet Count', check_type: 'Count', specification: '10 tablets/blister', frequency: 'Every 15 min' },
        ],
      },
    ],
  },
];

export const DEMO_BOM = [
  { id: cid(), material_code: 'RM-API-001', material_name: 'Metformin HCl API', quantity_per_batch: '100', unit: 'kg', tolerance_pct: '0.5', tolerance_type: '±', overage_pct: '0', supplier: 'Dr. Reddys', grade: 'USP', is_active_ingredient: true, dispensing_sequence: 1 },
  { id: cid(), material_code: 'RM-EXC-001', material_name: 'Microcrystalline Cellulose (Avicel PH-102)', quantity_per_batch: '30', unit: 'kg', tolerance_pct: '1.0', tolerance_type: '±', overage_pct: '0', supplier: 'FMC BioPolymer', grade: 'NF', is_active_ingredient: false, dispensing_sequence: 2 },
  { id: cid(), material_code: 'RM-EXC-002', material_name: 'Povidone K30', quantity_per_batch: '8', unit: 'kg', tolerance_pct: '1.0', tolerance_type: '±', overage_pct: '0', supplier: 'BASF', grade: 'USP', is_active_ingredient: false, dispensing_sequence: 3 },
  { id: cid(), material_code: 'RM-EXC-003', material_name: 'Magnesium Stearate', quantity_per_batch: '2', unit: 'kg', tolerance_pct: '2.0', tolerance_type: '±', overage_pct: '0', supplier: 'Mallinckrodt', grade: 'NF', is_active_ingredient: false, dispensing_sequence: 4 },
  { id: cid(), material_code: 'RM-SOL-001', material_name: 'Purified Water', quantity_per_batch: '15', unit: 'L', tolerance_pct: '5.0', tolerance_type: '±', overage_pct: '0', supplier: 'In-house WFI', grade: 'USP', is_active_ingredient: false, dispensing_sequence: 5 },
  { id: cid(), material_code: 'RM-COT-001', material_name: 'Opadry White (Film Coat)', quantity_per_batch: '6', unit: 'kg', tolerance_pct: '2.0', tolerance_type: '±', overage_pct: '0', supplier: 'Colorcon', grade: 'Pharma', is_active_ingredient: false, dispensing_sequence: 6 },
  { id: cid(), material_code: 'PM-BLS-001', material_name: 'Alu-Alu Blister Foil', quantity_per_batch: '50', unit: 'rolls', tolerance_pct: '5.0', tolerance_type: '±', overage_pct: '0', supplier: 'Amcor', grade: 'Pharma', is_active_ingredient: false, dispensing_sequence: 7 },
  { id: cid(), material_code: 'PM-CTN-001', material_name: 'Cartons (printed)', quantity_per_batch: '20000', unit: 'pcs', tolerance_pct: '2.0', tolerance_type: '±', overage_pct: '0', supplier: 'PrintPack', grade: 'N/A', is_active_ingredient: false, dispensing_sequence: 8 },
];

export const DEMO_SIGNATURES = [];
