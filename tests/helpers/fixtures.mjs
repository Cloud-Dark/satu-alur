/**
 * Synthetic flow data (requests -> ledger) for unit tests. Every request sits
 * at a different stage so buildModel()/requestStage()/work queues and the
 * adviser snapshot can be checked against hand-computed numbers.
 *
 * Reference "today": 15 Oct 2026 12:00 local time (NOW).
 *
 *  req  customer      service       offer status   assignment   completion  ledger
 *  1    PT Maju       Servis AC     approved       done         c1          rev 2.000.000 + tenaga 500.000 (10 Aug)
 *  2    "pt  maju "   Servis AC     approved       done         c2          rev 3.000.000 + bahan 300.000 (12 Sep)
 *  3    Bu Sari       Cuci sofa     approved       done         c3          rev 1.000.000 (20 Sep)
 *  4    Toko Jaya     Servis AC     approved       assigned     -           -
 *  5    CV Baru       Servis AC     approved       -            -           -
 *  6    Hotel X       Deep clean    draft          -            -           -
 *  7    Klinik Y      Deep clean    rejected       -            -           -
 *  8    Rumah Z       Cuci sofa     -              -            -           -
 *  9    Resto Q       Servis AC     approved       done         c9          - (not booked)
 *  10   PT Maju       Servis AC     approved       done         c10         rev 1.500.000 (5 Oct)
 */
export const NOW = new Date(2026, 9, 15, 12, 0, 0)

const at = (m, d) => new Date(2026, m, d, 10, 0, 0).toISOString()

export function rawFlow() {
  const requests = [
    { id: 1, customer_name: 'PT Maju', service_type: 'Servis AC', location: 'Bekasi', created_at: at(7, 1) },
    { id: 2, customer_name: 'pt  maju ', service_type: 'Servis AC', location: 'Bekasi', created_at: at(8, 1) },
    { id: 3, customer_name: 'Bu Sari', service_type: 'Cuci sofa', location: 'Bandung', created_at: at(8, 15) },
    { id: 4, customer_name: 'Toko Jaya', service_type: 'Servis AC', created_at: at(9, 1) },
    { id: 5, customer_name: 'CV Baru', service_type: 'Servis AC', created_at: at(9, 2) },
    { id: 6, customer_name: 'Hotel X', service_type: 'Deep clean', created_at: at(9, 3) },
    { id: 7, customer_name: 'Klinik Y', service_type: 'Deep clean', created_at: at(9, 4) },
    { id: 8, customer_name: 'Rumah Z', service_type: 'Cuci sofa', created_at: at(9, 10) },
    { id: 9, customer_name: 'Resto Q', service_type: 'Servis AC', created_at: at(9, 5) },
    { id: 10, customer_name: 'PT Maju', service_type: 'Servis AC', created_at: at(9, 1) },
  ]
  const offer = (id, request_id, status, price) => ({ id, request_id, status, validated_price: price, ai_proposal_json: { price }, created_at: at(9, 1) })
  const offers = [
    offer(11, 1, 'approved', 2000000),
    offer(12, 2, 'approved', 3000000),
    offer(13, 3, 'approved', 1000000),
    offer(14, 4, 'approved', 800000),
    offer(15, 5, 'approved', 600000),
    offer(16, 6, 'draft', 5000000),
    offer(17, 7, 'rejected', 9000000),
    offer(19, 9, 'approved', 700000),
    offer(20, 10, 'approved', 1500000),
  ]
  const asg = (id, offer_id, status) => ({ id, offer_id, worker_name: 'Tim A', status, created_at: at(9, 1) })
  const assignments = [asg(21, 11, 'done'), asg(22, 12, 'done'), asg(23, 13, 'done'), asg(24, 14, 'assigned'), asg(29, 19, 'done'), asg(30, 20, 'done')]
  const cpl = (id, assignment_id) => ({ id, assignment_id, status: 'done', notes: 'ok', created_at: at(9, 1) })
  const completions = [cpl(31, 21), cpl(32, 22), cpl(33, 23), cpl(39, 29), cpl(40, 30)]
  const led = (id, completion_id, category, amount, m, d) => ({ id, completion_id, category, amount, status: 'posted', posted_at: at(m, d), created_at: at(m, d) })
  const ledger_entries = [
    led(41, 31, 'pendapatan', 2000000, 7, 10),
    led(42, 31, 'biaya_tenaga', 500000, 7, 10),
    led(43, 32, 'pendapatan', 3000000, 8, 12),
    led(44, 32, 'biaya_bahan', 300000, 8, 12),
    led(45, 33, 'pendapatan', 1000000, 8, 20),
    led(46, 40, 'pendapatan', 1500000, 9, 5),
  ]
  return { requests, offers, assignments, completions, ledger_entries }
}
