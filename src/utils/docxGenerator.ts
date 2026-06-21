import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

/**
 * Utility for DOCX exports
 */
export class DOCXGenerator {
  /**
   * Generates a beautifully formatted Study Roadmap DOCX
   */
  static async generateRoadmapDocx(roadmap: any): Promise<Buffer> {
    const structure = typeof roadmap.structure === 'string' ? JSON.parse(roadmap.structure) : roadmap.structure;
    const weeks = Array.isArray(structure) ? structure : (structure.weeks || []);

    const children: any[] = [
      new Paragraph({
        text: roadmap.title || 'Study Roadmap',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 }
      }),
      new Paragraph({
        text: `Duration: ${roadmap.durationDays} Days | Created: ${new Date(roadmap.createdAt || Date.now()).toLocaleDateString()}`,
        spacing: { after: 300 }
      })
    ];

    for (const week of weeks) {
      children.push(
        new Paragraph({
          text: week.title || `Week ${week.week}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 }
        })
      );

      if (week.weekGoal) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Goal: ", bold: true }),
              new TextRun({ text: week.weekGoal, italics: true })
            ],
            spacing: { after: 100 }
          })
        );
      }

      if (week.topics && week.topics.length > 0) {
        const topicNames = week.topics.map((t: any) => typeof t === 'string' ? t : (t.name || '')).filter(Boolean);
        if (topicNames.length > 0) {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: "Topics to Learn: ", bold: true }),
                new TextRun({ text: topicNames.join(', ') })
              ],
              spacing: { after: 100 }
            })
          );
        }
      }

      if (week.courses && week.courses.length > 0) {
        children.push(new Paragraph({ text: "Learning Resources:", heading: HeadingLevel.HEADING_3, spacing: { before: 100, after: 50 } }));
        for (const course of week.courses) {
          if (course.topic) {
            children.push(new Paragraph({
              children: [
                new TextRun({ text: course.topic, bold: true })
              ],
              spacing: { before: 50 }
            }));
          }
          children.push(new Paragraph({ text: `Course: ${course.name}`, bullet: { level: 0 } }));
          children.push(new Paragraph({ text: `Platform: ${course.platform}`, bullet: { level: 0 } }));
          if (course.link) {
            children.push(new Paragraph({ text: `Link: ${course.link}`, bullet: { level: 0 } }));
          }
        }
      }

      if (week.practiceTasks && week.practiceTasks.length > 0) {
        children.push(new Paragraph({ text: "Practice Tasks:", heading: HeadingLevel.HEADING_3, spacing: { before: 100, after: 50 } }));
        for (const task of week.practiceTasks) {
          const taskTitle = typeof task === 'string' ? task : (task.title || `Task`);
          children.push(new Paragraph({ text: `• ${taskTitle}`, bullet: { level: 0 } }));
        }
      }

      if (week.certifications && week.certifications.length > 0) {
        children.push(new Paragraph({ text: "Certifications:", heading: HeadingLevel.HEADING_3, spacing: { before: 100, after: 50 } }));
        for (const cert of week.certifications) {
          const certName = typeof cert === 'string' ? cert : cert.name;
          const certLink = typeof cert === 'string' || !cert.link ? '' : cert.link;
          children.push(new Paragraph({ text: certName, bullet: { level: 0 } }));
          if (certLink) {
            children.push(new Paragraph({ text: `Link: ${certLink}`, bullet: { level: 0 } }));
          }
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * Generates a detailed Mock Interview feedback report DOCX
   */
  static async generateInterviewReportDocx(session: any): Promise<Buffer> {
    const scores = [
      new Paragraph({ text: `• Technical Score: ${session.technicalScore || 0}%`, bullet: { level: 0 } }),
      new Paragraph({ text: `• Communication Score: ${session.communicationScore || 0}%`, bullet: { level: 0 } }),
      new Paragraph({ text: `• Confidence Score: ${session.confidenceScore || 0}%`, bullet: { level: 0 } }),
      new Paragraph({ text: `• Behavioral Score: ${session.behavioralScore || 0}%`, bullet: { level: 0 } }),
      new Paragraph({ text: `• Professionalism Score: ${session.professionalismScore || 0}%`, bullet: { level: 0 } }),
      new Paragraph({ text: `• Leadership Presence Score: ${session.leadershipPresenceScore || 0}%`, bullet: { level: 0 } }),
    ];

    let strengths: string[] = [];
    let improvements: string[] = [];
    try {
      if (session.behavioralStrengths) strengths = JSON.parse(session.behavioralStrengths);
    } catch {}
    try {
      if (session.behavioralImprovements) improvements = JSON.parse(session.behavioralImprovements);
    } catch {}

    const strengthsParagraphs = strengths.map(s => new Paragraph({ text: `• ${s}`, bullet: { level: 0 } }));
    const improvementsParagraphs = improvements.map(imp => new Paragraph({ text: `• ${imp}`, bullet: { level: 0 } }));

    const children: any[] = [
      new Paragraph({
        text: 'Mock Interview Performance Report',
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 }
      }),
      new Paragraph({
        text: `Role: ${session.role} | Target: ${session.company} | Difficulty: ${session.difficulty}`,
        spacing: { after: 300 }
      }),
      new Paragraph({
        text: 'Score Breakdown',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Overall Performance Score: ", bold: true }),
          new TextRun({ text: `${session.overallScore || 0}/100`, bold: true })
        ],
        spacing: { after: 100 }
      }),
      ...scores,
      new Paragraph({ text: '', spacing: { after: 200 } })
    ];

    if (strengths.length > 0) {
      children.push(new Paragraph({ text: 'AI Behavioral Strengths', heading: HeadingLevel.HEADING_2, spacing: { before: 150, after: 50 } }));
      children.push(...strengthsParagraphs);
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
    }

    if (improvements.length > 0) {
      children.push(new Paragraph({ text: 'AI Areas for Improvement', heading: HeadingLevel.HEADING_2, spacing: { before: 150, after: 50 } }));
      children.push(...improvementsParagraphs);
      children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
    }

    if (session.feedback) {
      children.push(new Paragraph({ text: 'AI Diagnostic Feedback', heading: HeadingLevel.HEADING_2, spacing: { before: 150, after: 50 } }));
      children.push(new Paragraph({ text: session.feedback, spacing: { after: 200 } }));
    }

    const questions = session.questions || [];
    if (questions.length > 0) {
      children.push(new Paragraph({ text: 'Question Review', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
      
      questions.forEach((q: any, idx: number) => {
        children.push(
          new Paragraph({
            text: `Q${idx + 1}: ${q.text}`,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 150, after: 50 }
          })
        );

        if (q.answer) {
          children.push(new Paragraph({ text: `Score: ${q.answer.score}/100`, spacing: { after: 20 } }));
          children.push(new Paragraph({ text: `Your Answer: "${q.answer.answerText}"`, spacing: { after: 20 } }));
          children.push(new Paragraph({ text: `Expected Answer: "${q.answer.expectedAnswer}"`, spacing: { after: 20 } }));
          children.push(new Paragraph({ text: `Improvement Tips: ${q.answer.improvementTips || 'N/A'}`, spacing: { after: 20 } }));

          if (q.answer.behavioralDetails) {
            try {
              const details = JSON.parse(q.answer.behavioralDetails);
              children.push(new Paragraph({
                text: `Presentation & Behavioral: Behavioral: ${q.answer.behavioralScore}% | Eye Contact: ${q.answer.eyeContactScore}% | Body Language: ${q.answer.bodyLanguageScore}% | Voice Quality: ${q.answer.voiceQualityScore}% | Professionalism: ${q.answer.professionalismScore}%`,
                spacing: { after: 20 }
              }));
              children.push(new Paragraph({
                text: `Speaking Pace: ${details.speakingPaceWpm} WPM (${details.speakingPaceFeedback || 'N/A'})`,
                spacing: { after: 20 }
              }));
              children.push(new Paragraph({
                text: `Filler Words: ${details.fillerWordCount} counts`,
                spacing: { after: 100 }
              }));
            } catch (e) {
              children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
            }
          } else {
            children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
          }
        } else {
          children.push(new Paragraph({ text: 'Unanswered/Skipped.', spacing: { after: 100 } }));
        }
      });
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    return await Packer.toBuffer(doc);
  }

  /**
   * Generates a clean professional Resume DOCX from text
   */
  static async generateResumeDocx(text: string, mode: string = 'MODIFY_EXISTING'): Promise<Buffer> {
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

    const lines = text.split('\n');
    const children: any[] = [];
    let isFirst = true;

    // Choose styling variables
    const nameSize = mode === 'GENERATE_NEW' ? 44 : 36; // 44 half-points = 22pt, 36 half-points = 18pt
    const headingColor = mode === 'GENERATE_NEW' ? '1E3A8A' : '0F172A'; // Navy Blue for New, Slate for Modify
    const bodyColor = '1E293B';
    const subheaderColor = '475569';
    const alignCenter = mode !== 'GENERATE_NEW';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const sectionHeader = getSectionHeader(trimmed);
      if (sectionHeader) {
        const title = sectionHeader.toUpperCase();
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: title, bold: true, color: headingColor, size: 24 }) // 12pt
            ],
            spacing: { before: 180, after: 80 }
          })
        );
      } else if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
        const bulletText = trimmed.replace(/^[-•*]\s*/, '').trim();
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: bulletText, size: 19, color: bodyColor }) // 9.5pt
            ],
            bullet: { level: 0 },
            spacing: { after: 30 }
          })
        );
      } else if (isFirst) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: trimmed, bold: true, color: headingColor, size: nameSize })
            ],
            alignment: alignCenter ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { after: 100 }
          })
        );
        isFirst = false;
      } else if (trimmed.includes('@') || trimmed.includes('|') || trimmed.includes('+')) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: trimmed, color: subheaderColor, size: 19 }) // 9.5pt
            ],
            alignment: alignCenter ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { after: 120 }
          })
        );
      } else {
        const isMetadataLine = trimmed.includes('|') && (trimmed.includes('20') || trimmed.includes('Present') || trimmed.includes('19'));
        
        if (isMetadataLine && mode === 'GENERATE_NEW') {
          const parts = trimmed.split('|').map(p => p.trim());
          const datePart = parts.pop() || '';
          const mainText = parts.join('  |  ');
          
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: mainText, bold: true, color: headingColor, size: 20 }), // 10pt
                new TextRun({ text: `\t${datePart}`, color: subheaderColor, size: 19, italics: true }) // Tab/Space alignment
              ],
              spacing: { after: 60 }
            })
          );
        } else {
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: trimmed, size: 19, color: bodyColor }) // 9.5pt
              ],
              spacing: { after: 60 }
            })
          );
        }
      }
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    return await Packer.toBuffer(doc);
  }
}
