// =============================================================================
// SARHAD UNIVERSITY – FALL 2026 ADMISSIONS
// DISTANCE EDUCATION CENTER (DEC), ALAM PUBLIC SCHOOL & COLLEGE, JUTIAL, GILGIT
// Official Verified Knowledge Base
// =============================================================================

export interface UniversityProgram {
  id: string;
  name: string;
  category: string;
  description: string;
}

export const SARHAD_UNIVERSITY_INFO = {
  universityName: "Sarhad University of Science & Information Technology",
  centerName: "Distance Education Center (DEC)",
  centerLocation: "Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit",
  shortLocation: "Alam Public School & College, Jutial, Gilgit",
  session: "Fall 2026 Admissions",
  deadlineDate: "10 September 2026",
  deadlineFormatted: "10th September 2026",
  minimumPercentage: 45,
  programs: [
    { id: "education", name: "Education", category: "Social Sciences", description: "Comprehensive study of educational theory, pedagogy, and curriculum design." },
    { id: "english", name: "English", category: "Languages & Literature", description: "Literature, linguistics, communication skills, and critical analysis." },
    { id: "urdu", name: "Urdu", category: "Languages & Literature", description: "Advanced Urdu language, classical & modern literature, and poetry." },
    { id: "bba", name: "BBA (Business Administration)", category: "Management Sciences", description: "Business management, marketing, finance, entrepreneurship, and leadership." },
    { id: "physical_education", name: "Health & Physical Education", category: "Sports & Health", description: "Exercise science, sports physiology, physical fitness, and health education." },
    { id: "bed", name: "B.Ed (Bachelor of Education)", category: "Teacher Education", description: "Professional teacher training, classroom management, and modern teaching methodologies." },
  ] as UniversityProgram[],
  degreeOptions: {
    afterIntermediate: [
      {
        title: "2-Year Associate Degree Program (ADP)",
        duration: "2 Years (4 Semesters)",
        equivalent: "Equivalent to Graduation / Traditional 2-Year BA/BSc",
        eligibility: "Minimum 45% marks in FA / FSc / I.Com / ICS or equivalent",
      },
      {
        title: "4-Year BS Program",
        duration: "4 Years (8 Semesters)",
        equivalent: "Full 16-Year Honours Degree",
        eligibility: "Minimum 45% marks in FA / FSc / I.Com / ICS or equivalent",
      },
    ],
    afterGraduation: [
      {
        title: "2.5-Year BS Program",
        duration: "2.5 Years (5 Semesters)",
        equivalent: "Bridge program converting 14-year education to 16-year BS degree",
        eligibility: "Completed 2-year Graduation (BA/BSc/B.Com) or Associate Degree (ADP) with minimum 45% marks",
      },
    ],
  },
  studyMechanics: {
    lms: "After admission confirmation, students receive personal LMS IDs. Recorded video lectures are uploaded to the LMS.",
    schedule: "Self-paced: students can watch video lectures anytime 24/7 according to their own schedule.",
    courseOutline: "Detailed course outline provided at the beginning of the semester.",
    topicsPerSubject: "Each subject has approximately 25 prescribed topics to prepare.",
    examination: "Examinations are strictly prepared from the prescribed course outline. Students attempt a 70-mark paper per subject according to the university examination system.",
  },
  physicalClasses: {
    schedule: "Every Sunday at Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit.",
    isCompulsory: false,
    note: "Sunday physical classes are 100% OPTIONAL. Students who cannot attend in person can study purely through LMS recorded lectures.",
    idealFor: "Ideal for working professionals, school/college teachers, government employees, and students in remote areas of Gilgit-Baltistan who cannot attend regular daily classes.",
  },
  admissionSteps: [
    "1. Desired program select karein (apni previous qualification k mutabiq).",
    "2. DEC Alam Public School & College, Jutial, Gilgit visit karein guidance aur registration k liye.",
    "3. Required educational documents (Matric & Inter DMC/Certificates, CNIC/B-Form copy, photographs) submit karein.",
    "4. Admission confirm hone par student ko unka LMS ID mil jata hai.",
    "5. LMS par recorded lectures available honge jo student apnay schedule k mutabiq dekh saktay hain.",
    "6. Course outline receive karein (har subject k taqreeban 25 prescribed topics).",
    "7. Semester end par 70-mark paper attempt karein DEC examination center mein.",
  ],
};

export function getDaysRemainingUntilDeadline(): number {
  const deadline = new Date("2026-09-10T23:59:59+05:00");
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}
