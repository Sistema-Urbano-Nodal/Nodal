/* Who may join Curso Movilidad Nivel 2 now that it is closed, and where its September group ends
   (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md). One course, one festival, two instants; phase 2
   replaces this with a per-course setting. Dates are compared as instants: Supabase returns FIIU created_at as
   '…+00:00' with microseconds, course rows use the '…Z' text form. */
export const FIIU_COURSE_PERK = Object.freeze({
  courseId:'72e3cc56-a506-4a1b-97b5-9333e8d283ca',
  eventId:'fiiu-2026',
  registeredBefore:'2026-10-26T05:00:00Z', // end of 25 Oct 2026 in Lima (UTC-05:00, no DST)
  septemberBefore:'2026-10-01T00:00:00Z',  // a UTC instant: enrolments and posts before it are the September group's
});
const instant=value=>Date.parse(value??'');
export function createCoursePerks({fiiuStore=null,perk=FIIU_COURSE_PERK}={}) {
  const courseId=perk.courseId.toLowerCase(),registeredBefore=instant(perk.registeredBefore),septemberBefore=instant(perk.septemberBefore);
  return Object.freeze({
    courseId,
    applies:id=>typeof id==='string'&&id.toLowerCase()===courseId,
    // An enrolment whose date cannot be read is not the September group's: its holder gets the filtered view.
    inSeptemberGroup:enrollment=>instant(enrollment?.createdAt)<septemberBefore,
    // A post whose date cannot be read stays with the September group: new joiners never see it.
    septemberPost:post=>!(instant(post?.createdAt)>=septemberBefore),
    async fiiuEligible(user) {
      if(!fiiuStore||!user?.id||user.permission==='admin')return false;
      const [registration]=await fiiuStore.find('registrations',{eventId:perk.eventId,userId:user.id},{limit:1});
      return instant(registration?.createdAt)<registeredBefore;
    },
  });
}
