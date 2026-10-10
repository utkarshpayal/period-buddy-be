import Doctor from '../models/Doctor.js';
import User from '../models/User.js';
import {
  prescriptionFileName,
  prescriptionNumber,
  renderPrescriptionHtml,
} from '../templates/prescriptionTemplate.js';

/**
 * The printable prescription for a consultation that has one: `{ html,
 * fileName, number }`, or null when nothing has been prescribed. Shared by
 * the patient's and the doctor's endpoints so both get the same document.
 */
export const buildPrescriptionDocument = async (consultation) => {
  if (!consultation?.prescription?.trim()) return null;
  const [doctor, patient] = await Promise.all([
    Doctor.findById(consultation.doctorId)
      .select('name specialty education licenses hospital')
      .lean(),
    User.findById(consultation.userId).select('_id firstName lastName dateOfBirth gender').lean(),
  ]);
  const issuedAt = consultation.prescribedAt || consultation.updatedAt || new Date();
  return {
    html: renderPrescriptionHtml({ consultation, doctor, patient, issuedAt }),
    fileName: prescriptionFileName({ issuedAt, doctorName: doctor?.name }),
    number: prescriptionNumber(consultation._id),
  };
};
