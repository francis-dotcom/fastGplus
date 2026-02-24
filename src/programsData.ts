export type DeptKey =
  | 'health'
  | 'technology'
  | 'business'
  | 'computer'
  | 'languages'
  | 'science'
  | 'math'
  | 'social'
  | 'education'

export type SegmentKey = 'undergraduate' | 'certificate'

export interface Program {
  id: string
  title: string
  dept: DeptKey
  segment: SegmentKey
  image: string
  imageAlt: string
  meta: string // e.g. "🎓 NCE" "⏱ 4 Years"
}

export const PROGRAMS: Program[] = [
  { id: 'nursing', title: 'NCE Nursing (Adult Health)', dept: 'health', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&q=80', imageAlt: 'NCE Nursing (Adult Health)', meta: '🎓 NCE · ⏱ 4 Years' },
  { id: 'it', title: 'NCE Information Technology', dept: 'technology', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=400&q=80', imageAlt: 'NCE Information Technology', meta: '🎓 NCE · ⏱ 4 Years' },
  { id: 'business', title: 'NCE Business Administration', dept: 'business', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80', imageAlt: 'NCE Business Administration', meta: '🎓 NCE · ⏱ 3 Years' },
  { id: 'comp-bio', title: 'Computer Education / Biology', dept: 'computer', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&q=80', imageAlt: 'Computer Education / Biology', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'comp-math', title: 'Computer Education / Mathematics', dept: 'computer', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1509228468518-180dd486490e?w=400&q=80', imageAlt: 'Computer Education / Mathematics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'cs-int', title: 'Computer Science / Integrated Science', dept: 'computer', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1517976487492-5750f3195933?w=400&q=80', imageAlt: 'Computer Science / Integrated Science', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'cs-physics', title: 'Computer Science / Physics', dept: 'computer', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&q=80', imageAlt: 'Computer Science / Physics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'arabic-islamic', title: 'Arabic / Islamic Studies', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?w=400&q=80', imageAlt: 'Arabic / Islamic Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'crs-social', title: 'CRS / Social Studies', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1519781542704-957ff19eff00?w=400&q=80', imageAlt: 'CRS / Social Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'english-crs', title: 'English / CRS', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&q=80', imageAlt: 'English / CRS', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'english-islamic', title: 'English / Islamic Studies', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1505664194779-8beaceb93744?w=400&q=80', imageAlt: 'English / Islamic Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'yoruba-crs', title: 'Yoruba / CRS', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1523050853064-dbad350e0225?w=400&q=80', imageAlt: 'Yoruba / CRS', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'yoruba-islamic', title: 'Yoruba / Islamic Studies', dept: 'languages', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1584036561566-baf8f1f1b144?w=400&q=80', imageAlt: 'Yoruba / Islamic Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'int-double', title: 'Integrated Science (Double Major)', dept: 'science', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=400&q=80', imageAlt: 'Integrated Science Double Major', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'int-bio', title: 'Integrated Science / Biology', dept: 'science', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1576086213369-97a306d36557?w=400&q=80', imageAlt: 'Integrated Science / Biology', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'int-chem', title: 'Integrated Science / Chemistry', dept: 'science', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1603126857599-f6e157fa2fe6?w=400&q=80', imageAlt: 'Integrated Science / Chemistry', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'int-math', title: 'Integrated Science / Mathematics', dept: 'science', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1635372722656-389f87a941b7?w=400&q=80', imageAlt: 'Integrated Science / Mathematics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'int-physics', title: 'Integrated Science / Physics', dept: 'science', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1636466497217-26a8cbeaf0aa?w=400&q=80', imageAlt: 'Integrated Science / Physics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'math-bio', title: 'Mathematics / Biology', dept: 'math', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1509228468518-180dd486490e?w=400&q=80', imageAlt: 'Mathematics / Biology', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'math-econ', title: 'Mathematics / Economics', dept: 'math', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=400&q=80', imageAlt: 'Mathematics / Economics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'math-physics', title: 'Mathematics / Physics', dept: 'math', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1453733190371-0a9bedd82893?w=400&q=80', imageAlt: 'Mathematics / Physics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'social-double', title: 'Social Studies (Double Major)', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=400&q=80', imageAlt: 'Social Studies Double Major', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'social-econ', title: 'Social Studies / Economics', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1454165833767-131438967469?w=400&q=80', imageAlt: 'Social Studies / Economics', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'social-pol', title: 'Social Studies / Political Science', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=400&q=80', imageAlt: 'Social Studies / Political Science', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'english-pol', title: 'English / Political Science', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1551816230-ef5deaed4a26?w=400&q=80', imageAlt: 'English / Political Science', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'english-social', title: 'English / Social Studies', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&q=80', imageAlt: 'English / Social Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'yoruba-pol', title: 'Yoruba / Political Science', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1589330664650-8dc444efecbe?w=400&q=80', imageAlt: 'Yoruba / Political Science', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'yoruba-social', title: 'Yoruba / Social Studies', dept: 'social', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1519781542704-957ff19eff00?w=400&q=80', imageAlt: 'Yoruba / Social Studies', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'agri', title: 'Agriculture Education (Double Major)', dept: 'education', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1523301343968-6a6ebf63c672?w=400&q=80', imageAlt: 'Agriculture Education', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'business-ed', title: 'Business Education (Double Major)', dept: 'education', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=400&q=80', imageAlt: 'Business Education', meta: '🎓 NCE · ⏱ 3-4 Years' },
  { id: 'primary', title: 'Primary Education (Double Major)', dept: 'education', segment: 'undergraduate', image: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&q=80', imageAlt: 'Primary Education', meta: '🎓 NCE · ⏱ 3-4 Years' },
]

export const DEPT_LABELS: Record<DeptKey, string> = {
  health: 'Health Sciences',
  technology: 'Technology & IT',
  business: 'Business & Economics',
  computer: 'Computer & Science Education',
  languages: 'Languages & Religious Studies',
  science: 'Integrated Science',
  math: 'Math & Physical Sciences',
  social: 'Social & Political Sciences',
  education: 'Education Programs',
}

export const FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'segment:undergraduate', label: 'NCE Programs' },
  { value: 'segment:certificate', label: 'Certificate' },
  { value: 'dept:health', label: 'Health Sciences' },
  { value: 'dept:technology', label: 'Technology & IT' },
  { value: 'dept:business', label: 'Business & Econ' },
  { value: 'dept:computer', label: 'Computer Education' },
  { value: 'dept:languages', label: 'Languages & Religion' },
  { value: 'dept:science', label: 'Integrated Science' },
  { value: 'dept:math', label: 'Math & Physical Sciences' },
  { value: 'dept:social', label: 'Social & Political Sciences' },
  { value: 'dept:education', label: 'Education Programs' },
]
