import PDFDocument from 'pdfkit';

/**
 * Utility for PDF exports
 */
export class PDFGenerator {
  /**
   * Generates a professional ATS-friendly Resume PDF from text
   */
  static generateResumePDF(text: string, mode: string = 'MODIFY_EXISTING'): Promise<Buffer> {
    const sectionHeadersKeywords = [
      'summary', 'professional summary', 'career summary', 'executive summary', 'profile', 'about me', 'personal statement',
      'objective', 'career objective',
      'experience', 'work experience', 'professional experience', 'employment history', 'employment', 'work history', 'job history',
      'skills', 'technical skills', 'key skills', 'core competencies', 'technologies', 'languages', 'frameworks', 'tools', 'skills & technologies',
      'projects', 'key projects', 'academic projects', 'personal projects',
      'education', 'academic background', 'academic history', 'academics',
      'certifications', 'certificates', 'credentials', 'licenses',
      'achievements', 'awards', 'honors',
      'publications', 'patents', 'presentations',
      'interests', 'hobbies', 'languages', 'skills & tools'
    ];

    const getSectionHeader = (line: string): string | null => {
      const trimmed = line.trim();
      if (trimmed.length < 2 || trimmed.length > 40) return null;
      
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return trimmed.substring(1, trimmed.length - 1).trim();
      }

      const clean = trimmed.replace(/[:.]$/, '').trim();
      const lower = clean.toLowerCase();

      const isKeyword = sectionHeadersKeywords.some(keyword => {
        return lower === keyword || lower === `${keyword}s` || lower.startsWith(`${keyword} `) || lower.endsWith(` ${keyword}`);
      });

      if (isKeyword) {
        return clean;
      }

      return null;
    };

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 40, left: 45, right: 45 }
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const lines = text.split('\n');
      let isFirst = true;

      const primaryColor = mode === 'GENERATE_NEW' ? '#1e3a8a' : '#0f172a'; // Navy Blue for New, Slate for Modify
      const secondaryColor = '#475569';
      const bodyColor = '#1e293b';
      const borderColor = '#cbd5e1';

      for (let line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          doc.moveDown(0.2);
          continue;
        }

        const sectionHeader = getSectionHeader(trimmed);
        if (sectionHeader) {
          const title = sectionHeader.toUpperCase();
          doc.moveDown(0.7);
          doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryColor).text(title);
          doc.moveDown(0.15);
          
          doc.strokeColor(borderColor).lineWidth(1.2)
            .moveTo(doc.x, doc.y)
            .lineTo(doc.page.width - 45, doc.y)
            .stroke();
          doc.moveDown(0.4);
        } else if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
          doc.font('Helvetica').fontSize(9.5).fillColor(bodyColor);
          const bulletText = trimmed.replace(/^[-•*]\s*/, '').trim();
          doc.text(`•  ${bulletText}`, {
            indent: 10,
            paragraphGap: 2.5,
            lineGap: 1.5
          });
        } else if (isFirst) {
          const nameSize = mode === 'GENERATE_NEW' ? 22 : 18;
          const alignType = mode === 'GENERATE_NEW' ? 'left' : 'center';
          doc.font('Helvetica-Bold').fontSize(nameSize).fillColor(primaryColor).text(trimmed, { align: alignType });
          isFirst = false;
          doc.moveDown(0.25);
        } else if (trimmed.includes('@') || trimmed.includes('|') || trimmed.includes('+')) {
          const alignType = mode === 'GENERATE_NEW' ? 'left' : 'center';
          const size = mode === 'GENERATE_NEW' ? 9.5 : 9;
          doc.font('Helvetica').fontSize(size).fillColor(secondaryColor).text(trimmed, { align: alignType });
          doc.moveDown(0.5);
          
          if (mode === 'GENERATE_NEW') {
            doc.strokeColor(borderColor).lineWidth(0.5)
              .moveTo(45, doc.y)
              .lineTo(doc.page.width - 45, doc.y)
              .stroke();
            doc.moveDown(0.5);
          }
        } else {
          const isMetadataLine = trimmed.includes('|') && (trimmed.includes('20') || trimmed.includes('Present') || trimmed.includes('19'));
          
          if (isMetadataLine && mode === 'GENERATE_NEW') {
            const parts = trimmed.split('|').map(p => p.trim());
            const datePart = parts.pop() || '';
            const mainText = parts.join('  |  ');
            
            doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryColor).text(mainText, {
              width: doc.page.width - 180,
              continued: false
            });
            doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(secondaryColor).text(datePart, {
              align: 'right',
              width: doc.page.width - 90
            });
            doc.moveDown(0.1);
          } else {
            doc.font('Helvetica').fontSize(9.5).fillColor(bodyColor).text(trimmed, {
              paragraphGap: 4,
              lineGap: 1.5
            });
          }
        }
      }

      doc.end();
    });
  }

  /**
   * Generates a beautifully formatted Study Roadmap PDF
   */
  static generateRoadmapPDF(roadmap: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 54, bottom: 54, left: 54, right: 54 }
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Title Card
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#4f46e5').text(roadmap.title || 'Study Roadmap', { align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`Duration: ${roadmap.durationDays} Days | Created: ${new Date(roadmap.createdAt || Date.now()).toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(1.5);

      const structure = typeof roadmap.structure === 'string' ? JSON.parse(roadmap.structure) : roadmap.structure;
      const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);

      for (const week of weeks) {
        // Week Title
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(week.title || `Week ${week.week}`);
        doc.moveDown(0.2);
        
        // Draw divider
        doc.strokeColor('#e2e8f0').lineWidth(1)
          .moveTo(doc.x, doc.y)
          .lineTo(doc.page.width - 54, doc.y)
          .stroke();
        doc.moveDown(0.4);

        // Week Goal
        if (week.weekGoal) {
          doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#475569').text(`Goal: ${week.weekGoal}`);
          doc.moveDown(0.5);
        }

        // Topics
        if (week.topics && week.topics.length > 0) {
          const topicNames = week.topics.map((t: any) => typeof t === 'string' ? t : (t.name || '')).filter(Boolean);
          if (topicNames.length > 0) {
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4f46e5').text('Topics to Learn:');
            doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(topicNames.join(', '), { paragraphGap: 6 });
            doc.moveDown(0.4);
          }
        }

        // Courses
        if (week.courses && week.courses.length > 0) {
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0284c7').text('Learning Resources:');
          for (const course of week.courses) {
            if (course.topic) {
              doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(course.topic, { indent: 10 });
            }
            doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Course: ${course.name}`, { indent: 15 });
            doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`Platform: ${course.platform}`, { indent: 15 });
            if (course.link) {
              doc.font('Helvetica').fontSize(9).fillColor('#4f46e5').text(`Link: ${course.link}`, { indent: 15 });
            }
            doc.moveDown(0.25);
          }
          doc.moveDown(0.4);
        }

        // Practice Tasks
        if (week.practiceTasks && week.practiceTasks.length > 0) {
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#059669').text('Practice Tasks:');
          for (const task of week.practiceTasks) {
            const taskTitle = typeof task === 'string' ? task : (task.title || `Task`);
            doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`•  ${taskTitle}`, { indent: 10, paragraphGap: 2 });
          }
          doc.moveDown(0.4);
        }

        // Certifications
        if (week.certifications && week.certifications.length > 0) {
          doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#7c3aed').text('Certifications:');
          for (const cert of week.certifications) {
            const certName = typeof cert === 'string' ? cert : cert.name;
            const certLink = typeof cert === 'string' || !cert.link ? '' : cert.link;
            doc.font('Helvetica').fontSize(9).fillColor('#334155').text(`•  ${certName}`, { indent: 10 });
            if (certLink) {
              doc.font('Helvetica').fontSize(9).fillColor('#4f46e5').text(`   Link: ${certLink}`, { indent: 15 });
            }
            doc.moveDown(0.2);
          }
        }

        doc.moveDown(1.5);
      }

      doc.end();
    });
  }

  /**
   * Generates a detailed Mock Interview feedback report PDF
   */
  static generateInterviewReportPDF(session: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 54, bottom: 54, left: 54, right: 54 }
      });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Title Card
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#4f46e5').text('Mock Interview Performance Report', { align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(`Role: ${session.role} | Target: ${session.company} | Difficulty: ${session.difficulty}`, { align: 'center' });
      doc.moveDown(1.5);

      // Score Metrics Block
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Overall Score Breakdown');
      doc.moveDown(0.2);
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.page.width - 54, doc.y).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(`Overall Performance Score: `, { continued: true });
      doc.fillColor('#4f46e5').text(`${session.overallScore || 0}/100`);
      doc.moveDown(0.4);

      // Grids
      const scores = [
        { label: 'Technical Score', value: `${session.technicalScore || 0}%` },
        { label: 'Communication Score', value: `${session.communicationScore || 0}%` },
        { label: 'Confidence Score', value: `${session.confidenceScore || 0}%` },
        { label: 'Behavioral Score', value: `${session.behavioralScore || 0}%` },
        { label: 'Professionalism Score', value: `${session.professionalismScore || 0}%` },
        { label: 'Leadership Presence Score', value: `${session.leadershipPresenceScore || 0}%` }
      ];

      for (const item of scores) {
        doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(`-  ${item.label}: `, { continued: true });
        doc.font('Helvetica-Bold').fillColor('#0f172a').text(item.value);
      }
      doc.moveDown(0.8);

      // Strengths & Areas for Improvement
      let strengths: string[] = [];
      let improvements: string[] = [];
      try {
        if (session.behavioralStrengths) strengths = JSON.parse(session.behavioralStrengths);
      } catch {}
      try {
        if (session.behavioralImprovements) improvements = JSON.parse(session.behavioralImprovements);
      } catch {}

      if (strengths.length > 0) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#059669').text('AI Behavioral Strengths');
        doc.moveDown(0.2);
        for (const strength of strengths) {
          doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(`• ${strength}`, { indent: 10, paragraphGap: 2 });
        }
        doc.moveDown(0.6);
      }

      if (improvements.length > 0) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#d97706').text('AI Areas for Improvement');
        doc.moveDown(0.2);
        for (const imp of improvements) {
          doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(`• ${imp}`, { indent: 10, paragraphGap: 2 });
        }
        doc.moveDown(0.6);
      }

      // Feedback Text
      if (session.feedback) {
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text('AI Diagnostic Feedback:');
        doc.font('Helvetica').fontSize(9.5).fillColor('#334155').text(session.feedback, { paragraphGap: 12, lineGap: 2 });
        doc.moveDown(1);
      }

      // Question Level feedback
      const questions = session.questions || [];
      if (questions.length > 0) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text('Question-by-Question Review');
        doc.moveDown(0.2);
        doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(doc.x, doc.y).lineTo(doc.page.width - 54, doc.y).stroke();
        doc.moveDown(0.6);

        questions.forEach((q: any, idx: number) => {
          doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text(`Q${idx + 1}: ${q.text}`);
          doc.moveDown(0.3);

          if (q.answer) {
            // Answered
            doc.font('Helvetica').fontSize(9.5).fillColor('#475569').text(`Score: `, { continued: true });
            doc.font('Helvetica-Bold').fillColor('#059669').text(`${q.answer.score}/100`);
            doc.moveDown(0.2);

            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155').text(`Your Answer:`);
            doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`"${q.answer.answerText}"`, { paragraphGap: 4 });

            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155').text(`Ideal Answer Guide:`);
            doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`"${q.answer.expectedAnswer}"`, { paragraphGap: 4 });

            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#334155').text(`Critique & Improvement Suggestions:`);
            doc.font('Helvetica').fontSize(9).fillColor('#475569').text(q.answer.improvementTips || 'N/A', { paragraphGap: 6 });

            if (q.answer.behavioralDetails) {
              try {
                const details = JSON.parse(q.answer.behavioralDetails);
                doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4f46e5').text(`Presentation & Behavioral Scores:`);
                doc.font('Helvetica').fontSize(9).fillColor('#475569').text(
                  `•  Behavioral: ${q.answer.behavioralScore}%  |  Eye Contact: ${q.answer.eyeContactScore}%  |  Body Language: ${q.answer.bodyLanguageScore}%  |  Voice Quality: ${q.answer.voiceQualityScore}%  |  Professionalism: ${q.answer.professionalismScore}%`,
                  { indent: 10 }
                );
                doc.font('Helvetica').fontSize(9).fillColor('#475569').text(
                  `•  Speaking Pace: ${details.speakingPaceWpm} WPM (${details.speakingPaceFeedback || 'N/A'})`,
                  { indent: 10 }
                );
                doc.font('Helvetica').fontSize(9).fillColor('#475569').text(
                  `•  Filler Words: ${details.fillerWordCount} counts (Details: ${JSON.stringify(details.fillerWordsList || {})})`,
                  { indent: 10, paragraphGap: 10 }
                );
              } catch (e) {}
            }
          } else {
            // Unanswered
            doc.font('Helvetica-Oblique').fontSize(9.5).fillColor('#94a3b8').text('Unanswered or skipped.', { paragraphGap: 10 });
          }
          doc.moveDown(0.8);
        });
      }

      doc.end();
    });
  }
}
