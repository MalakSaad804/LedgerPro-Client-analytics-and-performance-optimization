require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Service = require('../src/models/Service');
const Availability = require('../src/models/Availability');
const Booking = require('../src/models/Booking');

async function ensureUser(name, email, password, role) {
  let user = await User.findOne({ email });
  if (user) {
    console.log(`${role} exists:`, email);
    return user;
  }
  user = await User.create({ name, email, password: await bcrypt.hash(password, 12), role });
  console.log(`${role} created:`, email);
  return user;
}

async function ensureHours(staff, startTime, endTime) {
  if (await Availability.countDocuments({ staff: staff._id })) return;
  await Availability.insertMany([1, 2, 3, 4, 5].map((dayOfWeek) => ({ staff: staff._id, dayOfWeek, startTime, endTime })));
  console.log(`Working hours created for ${staff.email}: Mon-Fri ${startTime}-${endTime}`);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const admin = await ensureUser('Admin', process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, 'admin');
  // two accountants, so data ownership can be tested (each only sees their own bookings)
  const staff1 = await ensureUser('Ayesha Khan', process.env.STAFF_EMAIL || 'staff@ledgerpro.com', process.env.STAFF_PASSWORD || 'Staff@12345', 'staff');
  const staff2 = await ensureUser('Bilal Ahmed', process.env.STAFF2_EMAIL || 'staff2@ledgerpro.com', process.env.STAFF_PASSWORD || 'Staff@12345', 'staff');
  await ensureHours(staff1, '09:00', '17:00');
  await ensureHours(staff2, '10:00', '18:00');

  if (!(await Service.countDocuments())) {
    await Service.insertMany([
      { name: 'Tax Consultation', description: 'One-to-one session to plan and file your taxes.', durationMins: 60, dailyCapacity: 8, createdBy: admin._id },
      { name: 'Audit Review', description: 'Review of your records ahead of an audit.', durationMins: 90, dailyCapacity: 4, createdBy: admin._id },
      { name: 'Bookkeeping Check-up', description: 'Quick health check of your books.', durationMins: 30, dailyCapacity: 10, createdBy: admin._id },
    ]);
    console.log('Demo services created');
  }

  // old bookings made before staff assignment existed: give them to the first accountant
  const legacy = await Booking.find({ $or: [{ staff: { $exists: false } }, { slotEnd: { $exists: false } }] }).populate('service', 'durationMins');
  for (const b of legacy) {
    if (!b.staff) b.staff = staff1._id;
    if (!b.slotEnd) b.slotEnd = new Date(b.slotStart.getTime() + (b.service?.durationMins || 60) * 60000);
    await b.save();
  }
  if (legacy.length) console.log(`Updated ${legacy.length} older booking(s) with staff and end time`);

  await mongoose.disconnect();
})();
