import { useState, useMemo, useRef, useEffect } from 'react'
import { PROGRAMS, DEPT_LABELS, FILTER_OPTIONS, type Program, type DeptKey } from './programsData'
import '../styles.css'

type FilterValue = string

function filterPrograms(programs: Program[], filter: FilterValue): Program[] {
  if (filter === 'all') return programs
  if (filter === 'segment:undergraduate') return programs.filter((p) => p.segment === 'undergraduate')
  if (filter === 'segment:certificate') return programs.filter((p) => p.segment === 'certificate')
  if (filter.startsWith('dept:')) {
    const dept = filter.replace('dept:', '') as DeptKey
    return programs.filter((p) => p.dept === dept)
  }
  return programs
}

function groupByDept(programs: Program[]): [DeptKey, Program[]][] {
  const map = new Map<DeptKey, Program[]>()
  for (const p of programs) {
    const list = map.get(p.dept) ?? []
    list.push(p)
    map.set(p.dept, list)
  }
  const order: DeptKey[] = ['health', 'technology', 'business', 'computer', 'languages', 'science', 'math', 'social', 'education']
  return order.filter((d) => map.has(d)).map((d) => [d, map.get(d)!])
}

export default function Programs() {
  const [selectedFilter, setSelectedFilter] = useState<FilterValue>('all')
  const [filterBoxOpen, setFilterBoxOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => filterPrograms(PROGRAMS, selectedFilter), [selectedFilter])
  const grouped = useMemo(() => groupByDept(filtered), [filtered])

  const selectedLabel = FILTER_OPTIONS.find((o) => o.value === selectedFilter)?.label ?? 'All'

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFilterBoxOpen(false)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  return (
    <>
      <section className="pg-hero">
        <div className="container">
          <h2 className="pg-hero-title">Programs</h2>
          <p className="pg-hero-sub">
            Explore industry-aligned degree & certificate programs designed to launch your career.
          </p>
        </div>
      </section>

      <section className="pg-filter-bar-section">
        <div className="container">
          <div
            className={`pg-filter-box ${filterBoxOpen ? 'active' : ''}`}
            ref={boxRef}
          >
            <div className="pg-filter-bar">
              <span className="pg-filter-bar-label">Filter by</span>
              <button
                type="button"
                className="pg-filter-bar-trigger"
                onClick={() => setFilterBoxOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={filterBoxOpen}
              >
                <span className="pg-filter-bar-value">{selectedLabel}</span>
                <svg className="pg-filter-bar-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
            <div className="pg-filter-bar-menu" role="listbox">
              {FILTER_OPTIONS.slice(0, 3).map((opt) => (
                <div
                  key={opt.value}
                  className={`pg-filter-bar-option ${selectedFilter === opt.value ? 'pg-filter-option-active' : ''}`}
                  role="option"
                  onClick={() => {
                    setSelectedFilter(opt.value)
                    setFilterBoxOpen(false)
                  }}
                >
                  {opt.label}
                </div>
              ))}
              <div className="pg-filter-bar-divider" role="separator" />
              {FILTER_OPTIONS.slice(3).map((opt) => (
                <div
                  key={opt.value}
                  className={`pg-filter-bar-option ${selectedFilter === opt.value ? 'pg-filter-option-active' : ''}`}
                  role="option"
                  onClick={() => {
                    setSelectedFilter(opt.value)
                    setFilterBoxOpen(false)
                  }}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pg-cards-section">
        <div className="container">
          <div className="pg-grid">
            {grouped.map(([dept, list]) => (
              <div key={dept}>
                <div className="pg-dept-header" data-dept={dept}>
                  <h3 className="pg-dept-title">
                    {DEPT_LABELS[dept]} <span className="pg-dept-count">({list.length})</span>
                  </h3>
                </div>
                {list.map((prog) => (
                  <article key={prog.id} className="pg-card" data-dept={prog.dept} data-segment={prog.segment}>
                    <div className="pg-card-img-wrap">
                      <span className="pg-badge pg-badge-green">Admission Open</span>
                      <img src={prog.image} alt={prog.imageAlt} className="pg-card-img" loading="lazy" />
                    </div>
                    <div className="pg-card-body">
                      <h3 className="pg-card-title">{prog.title}</h3>
                      <div className="pg-card-meta">
                        <span>{prog.meta}</span>
                      </div>
                      <a href="apply.html" className="btn btn-primary pg-btn">Apply Now</a>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pg-pagination-section">
        <div className="container">
          <div className="pg-pagination">
            <button type="button" className="pg-page-btn pg-page-active">1</button>
            <button type="button" className="pg-page-btn">2</button>
            <button type="button" className="pg-page-btn">3</button>
            <span className="pg-page-dots">…</span>
          </div>
        </div>
      </section>

      <section className="pg-banner-section">
        <div className="container">
          <div className="pg-banner">
            <h3 className="pg-banner-title">Ready to Start?</h3>
            <p className="pg-banner-text">Join thousands of students building their future at Grand Plus College.</p>
            <a href="apply.html" className="btn pg-banner-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Apply Now</a>
          </div>
        </div>
      </section>
    </>
  )
}
